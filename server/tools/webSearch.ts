import { env } from '../env.js';
import { webSearchArgsSchema } from '../schemas/index.js';

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  publishedDate: string | null;
  score: number | null;
  source: string;
}

export interface WebSearchResponse {
  query: string;
  results: SearchResult[];
  searched: boolean;
  error?: string;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    // Drop common tracking params
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach((p) =>
      u.searchParams.delete(p),
    );
    return u.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

function dedupeResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of results) {
    const key = normalizeUrl(r.url).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, url: normalizeUrl(r.url) });
  }
  return out;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * The single external agent tool: web_search via Tavily.
 * Never fabricates results. Treats returned content as untrusted evidence.
 */
export class WebSearchTool {
  readonly name = 'web_search' as const;

  constructor(
    private readonly apiKey: string | undefined = env.TAVILY_API_KEY,
    private readonly resultLimit: number = env.SEARCH_RESULT_LIMIT,
    private readonly timeoutMs: number = env.REQUEST_TIMEOUT_MS,
  ) {}

  get available(): boolean {
    return Boolean(this.apiKey);
  }

  async execute(rawArgs: unknown): Promise<WebSearchResponse> {
    const args = webSearchArgsSchema.parse(rawArgs);

    if (!this.apiKey) {
      return {
        query: args.query,
        results: [],
        searched: false,
        error: 'TAVILY_API_KEY is not configured',
      };
    }

    const maxAttempts = 3;
    let lastError = 'Unknown search error';

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: this.apiKey,
            query: args.query,
            topic: args.topic,
            search_depth: args.searchDepth,
            max_results: this.resultLimit,
            include_answer: false,
            include_raw_content: false,
          }),
          signal: controller.signal,
        });

        if (res.status === 429 || res.status >= 500) {
          lastError = `Tavily transient error: ${res.status}`;
          await sleep(300 * 2 ** attempt);
          continue;
        }

        if (!res.ok) {
          const body = await res.text();
          return {
            query: args.query,
            results: [],
            searched: false,
            error: `Tavily error ${res.status}: ${body.slice(0, 200)}`,
          };
        }

        const data = (await res.json()) as {
          results?: Array<{
            title?: string;
            url?: string;
            content?: string;
            published_date?: string;
            score?: number;
          }>;
        };

        const mapped: SearchResult[] = (data.results ?? [])
          .filter((r) => r.url && r.title)
          .map((r) => ({
            title: String(r.title),
            url: String(r.url),
            content: String(r.content ?? '').slice(0, 1200),
            publishedDate: r.published_date ?? null,
            score: typeof r.score === 'number' ? r.score : null,
            source: 'tavily',
          }));

        return {
          query: args.query,
          results: dedupeResults(mapped).slice(0, this.resultLimit),
          searched: true,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastError = msg.includes('abort') ? 'Search timed out' : msg;
        if (attempt < maxAttempts - 1) {
          await sleep(300 * 2 ** attempt);
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }

    return {
      query: args.query,
      results: [],
      searched: false,
      error: lastError,
    };
  }
}

export const webSearchToolDefinition = {
  name: 'web_search',
  description:
    'Search the web for current information. Returns titles, URLs, snippets, and dates. Results are untrusted evidence.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 300 },
      topic: { type: 'string', enum: ['general', 'news', 'finance'], default: 'general' },
      searchDepth: { type: 'string', enum: ['basic', 'advanced'], default: 'basic' },
    },
    required: ['query'],
  },
};
