import { describe, expect, it } from 'vitest';
import {
  classifyPriceChange,
  compareClaimsToWeb,
  contextsCompatible,
  extractPriceNumber,
  formatFindingsMarkdown,
} from '../server/agent/comparison.js';
import type { SearchResult } from '../server/tools/webSearch.js';

describe('price comparison logic', () => {
  it('extracts price numbers', () => {
    expect(extractPriceNumber('$45/mo')).toBe(45);
    expect(extractPriceNumber('USD 12.50')).toBe(12.5);
  });

  it('detects incompatible billing periods', () => {
    expect(contextsCompatible('$20 / month', '$200 / year')).toBe(false);
    expect(contextsCompatible('$20 / mo', '$25 per month')).toBe(true);
  });

  it('classifies changed and unchanged prices', () => {
    expect(classifyPriceChange('$20/mo', '$25/mo').classification).toBe('CHANGED');
    expect(classifyPriceChange('$20/mo', '$20/month').classification).toBe('UNCHANGED');
    expect(classifyPriceChange('$20/mo', '$240/year').classification).toBe('UNKNOWN');
  });

  it('never treats missing search results as UNCHANGED', () => {
    const findings = compareClaimsToWeb(
      [
        {
          subject: 'Neon',
          predicate: 'priced_at',
          value: '$19/mo',
          observedAt: '2025-11-04T10:00:00.000Z',
          messageId: 'm1',
          source: 'fact',
        },
      ],
      [],
      true,
    );
    expect(findings[0].classification).toBe('UNKNOWN');
    expect(findings[0].notes).toMatch(/not proof of no change/i);
  });

  it('marks UNKNOWN when search failed', () => {
    const findings = compareClaimsToWeb(
      [
        {
          subject: 'Neon',
          predicate: 'priced_at',
          value: '$19/mo',
          observedAt: '2025-11-04T10:00:00.000Z',
          messageId: 'm1',
          source: 'fact',
        },
      ],
      [],
      false,
    );
    expect(findings[0].classification).toBe('UNKNOWN');
    expect(findings[0].notes).toMatch(/did not succeed/i);
  });

  it('compares when current price evidence exists', () => {
    const results: SearchResult[] = [
      {
        title: 'Neon Pricing',
        url: 'https://neon.tech/pricing',
        content: 'Neon Launch plan is $25 / month for compute',
        publishedDate: '2025-11-09',
        score: 0.9,
        source: 'tavily',
      },
    ];
    const findings = compareClaimsToWeb(
      [
        {
          subject: 'Neon',
          predicate: 'priced_at',
          value: '$19/mo',
          observedAt: '2025-11-04T10:00:00.000Z',
          messageId: 'm1',
          source: 'fact',
        },
      ],
      results,
      true,
    );
    expect(findings[0].classification).toBe('CHANGED');
    expect(findings[0].current).toMatch(/25/);
    expect(findings[0].sources[0]).toContain('neon.tech');
  });

  it('formats findings for citations section', () => {
    const md = formatFindingsMarkdown([
      {
        subject: 'HubSpot',
        classification: 'CHANGED',
        historical: '$20',
        current: '$25',
        difference: '+5',
        confidence: 'medium',
        notes: null,
        sources: ['https://example.com'],
      },
    ]);
    expect(md).toContain('HubSpot');
    expect(md).toContain('CHANGED');
  });
});
