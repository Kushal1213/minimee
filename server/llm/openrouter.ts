import { z } from 'zod';
import { env } from '../env.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export class OpenRouterClient {
  constructor(
    private readonly apiKey: string | undefined = env.OPENROUTER_API_KEY,
    private readonly model: string = env.MODEL_NAME,
    private readonly baseUrl: string = env.OPENROUTER_BASE_URL,
  ) {}

  get available(): boolean {
    return Boolean(this.apiKey);
  }

  async chat(messages: ChatMessage[], options: LlmOptions = {}): Promise<string> {
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY is not configured');
    }

    const timeoutMs = options.timeoutMs ?? env.REQUEST_TIMEOUT_MS;
    const maxAttempts = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://minimi-research-agent.local',
            'X-Title': 'Minimi Research Agent',
          },
          body: JSON.stringify({
            model: this.model,
            messages,
            temperature: options.temperature ?? 0.2,
            max_tokens: options.maxTokens ?? 2000,
            ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
          }),
          signal: controller.signal,
        });

        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`OpenRouter transient error: ${res.status}`);
          await sleep(250 * 2 ** attempt);
          continue;
        }

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`OpenRouter error ${res.status}: ${body.slice(0, 300)}`);
        }

        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = data.choices?.[0]?.message?.content;
        if (!content) throw new Error('Empty LLM response');
        return content;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (lastError.name === 'AbortError') {
          lastError = new Error('OpenRouter request timed out');
        }
        const retryable =
          lastError.message.includes('transient') ||
          lastError.message.includes('timed out') ||
          lastError.message.includes('fetch');
        if (!retryable || attempt === maxAttempts - 1) throw lastError;
        await sleep(250 * 2 ** attempt);
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError ?? new Error('OpenRouter request failed');
  }

  async chatJson<T>(
    messages: ChatMessage[],
    schema: z.ZodType<T>,
    options: LlmOptions = {},
  ): Promise<T> {
    const raw = await this.chat(messages, { ...options, jsonMode: true });
    return parseJsonResponse(raw, schema);
  }

  /**
   * Stream tokens via callback. Falls back to non-streaming if stream fails mid-way.
   */
  async chatStream(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    options: LlmOptions = {},
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY is not configured');
    }

    const timeoutMs = options.timeoutMs ?? env.REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://minimi-research-agent.local',
          'X-Title': 'Minimi Research Agent',
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: options.temperature ?? 0.3,
          max_tokens: options.maxTokens ?? 2500,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        // Fallback to non-stream
        const text = await this.chat(messages, options);
        onToken(text);
        return text;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let full = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const token = json.choices?.[0]?.delta?.content;
            if (token) {
              full += token;
              onToken(token);
            }
          } catch {
            // ignore malformed SSE chunks
          }
        }
      }

      if (!full) {
        const text = await this.chat(messages, options);
        onToken(text);
        return text;
      }
      return full;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function parseJsonResponse<T>(raw: string, schema: z.ZodType<T>): T {
  let cleaned = raw.trim();
  // Strip markdown fences if present
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Attempt to extract first JSON object
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } else {
      throw new Error('Malformed model JSON response');
    }
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Schema validation failed: ${result.error.message}`);
  }
  return result.data;
}
