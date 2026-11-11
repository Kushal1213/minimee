import type { ComparisonFinding, ChangeClassification } from '../../shared/types.js';
import type { MemoryFact } from '../memory/engine.js';
import type { SearchResult } from '../tools/webSearch.js';

export interface HistoricalClaim {
  subject: string;
  predicate: string;
  value: string;
  unit?: string | null;
  observedAt: string;
  messageId: string;
  source: 'fact' | 'message';
  excerpt?: string;
}

/**
 * Deterministic helpers for price/feature comparison.
 * LLM may refine classifications, but these rules prevent "unchanged because no results" mistakes.
 */
export function extractPriceNumber(text: string): number | null {
  const m = text.replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return Number(m[1]);
}

export function normalizePlanContext(text: string): {
  billing?: string;
  seats?: string;
  region?: string;
} {
  const lower = text.toLowerCase();
  const billing = lower.match(/\b(per\s+)?(month|mo|year|yr|annual|monthly)\b/)?.[0];
  const seats = lower.match(/\b(\d+)\s*(users?|seats?|people)\b/)?.[0];
  const region = lower.match(/\b(usd|eur|gbp|inr|us|eu|india|uk)\b/)?.[0];
  return { billing, seats, region };
}

export function contextsCompatible(a: string, b: string): boolean {
  const ca = normalizePlanContext(a);
  const cb = normalizePlanContext(b);
  if (ca.billing && cb.billing) {
    const norm = (x: string) =>
      x.replace(/per\s+/g, '').replace(/\bmo\b/, 'month').replace(/\byr\b/, 'year');
    if (norm(ca.billing) !== norm(cb.billing)) return false;
  }
  return true;
}

export function classifyPriceChange(
  historical: string,
  current: string,
): { classification: ChangeClassification; difference: string | null } {
  const oldN = extractPriceNumber(historical);
  const newN = extractPriceNumber(current);
  if (oldN === null || newN === null) {
    return { classification: 'UNKNOWN', difference: null };
  }
  if (!contextsCompatible(historical, current)) {
    return {
      classification: 'UNKNOWN',
      difference: 'Billing period or plan context may differ; not treated as equivalent',
    };
  }
  const delta = newN - oldN;
  if (Math.abs(delta) < 0.005) {
    return { classification: 'UNCHANGED', difference: '0' };
  }
  const pct = oldN === 0 ? null : ((delta / oldN) * 100).toFixed(1);
  return {
    classification: 'CHANGED',
    difference: pct ? `${delta > 0 ? '+' : ''}${delta} (${pct}%)` : `${delta > 0 ? '+' : ''}${delta}`,
  };
}

export function claimsFromFacts(facts: MemoryFact[]): HistoricalClaim[] {
  return facts.map((f) => ({
    subject: f.subject,
    predicate: f.predicate,
    value: f.unit ? `${f.objectValue} ${f.unit}` : f.objectValue,
    unit: f.unit,
    observedAt: f.observedAt,
    messageId: f.messageId,
    source: 'fact' as const,
  }));
}

/**
 * Scan message text for claim-like price/product lines to support scenario C
 * when structured facts are sparse.
 */
export function claimsFromMessages(
  messages: Array<{ id: string; content: string; createdAt: string; role: string }>,
): HistoricalClaim[] {
  const claims: HistoricalClaim[] = [];
  for (const m of messages) {
    if (m.role !== 'assistant' && m.role !== 'user') continue;
    const re =
      /([A-Za-z][A-Za-z0-9.+ -]{1,40}?)\s*(?:pricing|price|costs?|at|:)?\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(mo|month|user\/mo|year|yr))?/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(m.content)) !== null) {
      claims.push({
        subject: match[1].trim(),
        predicate: 'priced_at',
        value: match[3] ? `$${match[2]}/${match[3]}` : `$${match[2]}`,
        observedAt: m.createdAt,
        messageId: m.id,
        source: 'message',
        excerpt: match[0].slice(0, 160),
      });
    }
  }
  return claims;
}

export function findCurrentEvidence(
  subject: string,
  results: SearchResult[],
): { snippet: string; urls: string[] } | null {
  const needle = subject.toLowerCase();
  const hits = results.filter(
    (r) =>
      r.title.toLowerCase().includes(needle) ||
      r.content.toLowerCase().includes(needle) ||
      r.url.toLowerCase().includes(needle.replace(/\s+/g, '')),
  );
  if (hits.length === 0) return null;
  return {
    snippet: hits.map((h) => h.content).join(' ').slice(0, 800),
    urls: hits.map((h) => h.url),
  };
}

/**
 * Compare historical claims against web evidence.
 * Absence of search results => UNKNOWN, never UNCHANGED.
 */
export function compareClaimsToWeb(
  claims: HistoricalClaim[],
  results: SearchResult[],
  searchSucceeded: boolean,
): ComparisonFinding[] {
  const findings: ComparisonFinding[] = [];
  const seen = new Set<string>();

  for (const claim of claims) {
    const key = `${claim.subject.toLowerCase()}::${claim.predicate}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (!searchSucceeded) {
      findings.push({
        subject: claim.subject,
        classification: 'UNKNOWN',
        historical: claim.value,
        current: null,
        difference: null,
        confidence: 'low',
        notes: 'Web search did not succeed; cannot verify current state',
        sources: [],
      });
      continue;
    }

    const evidence = findCurrentEvidence(claim.subject, results);
    if (!evidence) {
      findings.push({
        subject: claim.subject,
        classification: 'UNKNOWN',
        historical: claim.value,
        current: null,
        difference: null,
        confidence: 'low',
        notes:
          'No current web evidence found for this subject. Lack of results is not proof of no change.',
        sources: [],
      });
      continue;
    }

    if (claim.predicate.includes('price') || claim.predicate === 'priced_at') {
      const priceInSnippet = evidence.snippet.match(/\$\s?\d+(?:\.\d+)?(?:\s*\/\s*\w+)?/);
      if (!priceInSnippet) {
        findings.push({
          subject: claim.subject,
          classification: 'UNKNOWN',
          historical: claim.value,
          current: evidence.snippet.slice(0, 200),
          difference: null,
          confidence: 'low',
          notes: 'Current sources mention the product but do not clearly state a comparable price',
          sources: evidence.urls,
        });
        continue;
      }
      const { classification, difference } = classifyPriceChange(claim.value, priceInSnippet[0]);
      findings.push({
        subject: claim.subject,
        classification,
        historical: claim.value,
        current: priceInSnippet[0],
        difference,
        confidence: classification === 'UNKNOWN' ? 'low' : 'medium',
        notes: `Historical claim observed ${claim.observedAt}`,
        sources: evidence.urls,
      });
      continue;
    }

    // Non-price: keyword presence heuristics
    const discontinued = /\b(discontinued|sunset|no longer available|end of life|eol)\b/i.test(
      evidence.snippet,
    );
    if (discontinued) {
      findings.push({
        subject: claim.subject,
        classification: 'DISCONTINUED',
        historical: claim.value,
        current: evidence.snippet.slice(0, 200),
        difference: null,
        confidence: 'medium',
        notes: null,
        sources: evidence.urls,
      });
      continue;
    }

    const launch = /\b(launch(ed)?|announc(ed|ement)|new feature|released|shipping)\b/i.test(
      evidence.snippet,
    );
    findings.push({
      subject: claim.subject,
      classification: launch ? 'NEW' : 'UNKNOWN',
      historical: claim.value,
      current: evidence.snippet.slice(0, 240),
      difference: null,
      confidence: 'low',
      notes: launch
        ? 'Possible new announcement detected in sources; verify details'
        : 'Insufficient structured signal to classify change confidently',
      sources: evidence.urls,
    });
  }

  return findings;
}

export function formatFindingsMarkdown(findings: ComparisonFinding[]): string {
  if (findings.length === 0) return '';
  const lines = ['### Change analysis', ''];
  for (const f of findings) {
    lines.push(`- **${f.subject}** — \`${f.classification}\` (${f.confidence} confidence)`);
    if (f.historical) lines.push(`  - Historical: ${f.historical}`);
    if (f.current) lines.push(`  - Current: ${f.current}`);
    if (f.difference) lines.push(`  - Difference: ${f.difference}`);
    if (f.notes) lines.push(`  - Note: ${f.notes}`);
  }
  return lines.join('\n');
}
