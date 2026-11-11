import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSearchTool } from '../server/tools/webSearch.js';

describe('web_search tool', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('deduplicates URLs and normalizes results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              title: 'A',
              url: 'https://example.com/path/?utm_source=x',
              content: 'one',
              published_date: '2025-01-01',
              score: 0.8,
            },
            {
              title: 'A dup',
              url: 'https://example.com/path',
              content: 'two',
            },
          ],
        }),
      }),
    );

    const tool = new WebSearchTool('test-key', 5, 5000);
    const res = await tool.execute({ query: 'crm pricing', topic: 'general', searchDepth: 'basic' });
    expect(res.searched).toBe(true);
    expect(res.results).toHaveLength(1);
    expect(res.results[0].url).toBe('https://example.com/path');
  });

  it('retries transient failures then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'fail' })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          results: [{ title: 'Ok', url: 'https://ok.example', content: 'hi' }],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const tool = new WebSearchTool('test-key', 5, 5000);
    const res = await tool.execute({ query: 'test' });
    expect(res.searched).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not fabricate results on hard failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'unauthorized',
      }),
    );
    const tool = new WebSearchTool('test-key', 5, 5000);
    const res = await tool.execute({ query: 'test' });
    expect(res.searched).toBe(false);
    expect(res.results).toEqual([]);
    expect(res.error).toMatch(/401/);
  });

  it('reports missing API key without calling network', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  const tool = new WebSearchTool('', 5, 5000);
  const res = await tool.execute({ query: 'test' });

  expect(res.searched).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
});
});
