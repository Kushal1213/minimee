import { describe, expect, it } from 'vitest';
import type { Citation } from '../shared/types.js';

function formatCitationMarkdown(citations: Citation[]): string {
  return citations
    .map((c) => `[${c.id}] [${c.title}](${c.url})${c.publishedDate ? ` (${c.publishedDate})` : ''}`)
    .join('\n');
}

function extractCitationIds(answer: string): number[] {
  const ids = [...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  return [...new Set(ids)];
}

describe('citation formatting', () => {
  it('formats clickable markdown citations', () => {
    const md = formatCitationMarkdown([
      {
        id: 1,
        title: 'Neon Pricing',
        url: 'https://neon.tech/pricing',
        snippet: 'Launch $25',
        publishedDate: '2025-11-09',
      },
    ]);
    expect(md).toContain('[1] [Neon Pricing](https://neon.tech/pricing)');
    expect(md).toContain('2025-11-09');
  });

  it('only references ids that exist in citation list', () => {
    const citations: Citation[] = [
      { id: 1, title: 'A', url: 'https://a.example', snippet: '' },
      { id: 2, title: 'B', url: 'https://b.example', snippet: '' },
    ];
    const answer = 'Prices moved for Neon [1] and Supabase [2].';
    const ids = extractCitationIds(answer);
    expect(ids.every((id) => citations.some((c) => c.id === id))).toBe(true);
  });

  it('rejects fabricated citation ids', () => {
    const citations: Citation[] = [{ id: 1, title: 'A', url: 'https://a.example', snippet: '' }];
    const answer = 'According to [99] this is true';
    const ids = extractCitationIds(answer);
    expect(ids.every((id) => citations.some((c) => c.id === id))).toBe(false);
  });
});
