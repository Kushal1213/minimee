import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createTestDatabase } from '../server/db/client.js';
import { MemoryEngine } from '../server/memory/engine.js';
import {
  AgentOrchestrator,
  validateCitationMarkers,
} from '../server/agent/orchestrator.js';
import { OpenRouterClient } from '../server/llm/openrouter.js';
import { WebSearchTool } from '../server/tools/webSearch.js';
import { parseJsonResponse } from '../server/llm/openrouter.js';
import { intentSchema } from '../server/schemas/index.js';
import type { StreamEvent } from '../shared/types.js';

function collectEvents() {
  const events: StreamEvent[] = [];
  return {
    events,
    emit: (e: StreamEvent) => events.push(e),
  };
}

describe('agent orchestration', () => {
  let memory: MemoryEngine;

  beforeEach(() => {
    memory = new MemoryEngine(createTestDatabase());
  });

  it('classifies casual questions without web search', async () => {
    const search = new WebSearchTool('key');
    const execute = vi.spyOn(search, 'execute');
    const llm = {
      available: false,
      chatStream: vi.fn(),
      chatJson: vi.fn(),
    } as unknown as OpenRouterClient;

    const orch = new AgentOrchestrator({
      memory,
      llm,
      search,
      maxToolIterations: 3,
    });

    const conv = memory.createConversation('Asia/Kolkata');
    const { events, emit } = collectEvents();
    const result = await orch.handleTurn({
      conversationId: conv,
      userMessage: 'What is the difference between SQL and NoSQL?',
      timezone: 'Asia/Kolkata',
      emit,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.content.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'sources')).toBe(false);
  });

  it('enforces max tool iterations', async () => {
    const search = new WebSearchTool('key');
    let calls = 0;
    vi.spyOn(search, 'execute').mockImplementation(async (args) => {
      calls += 1;
      return {
        query: (args as { query: string }).query,
        searched: true,
        results: [
          {
            title: 'X',
            url: `https://example.com/${calls}`,
            content: 'price $10/mo',
            publishedDate: null,
            score: 1,
            source: 'tavily',
          },
        ],
      };
    });

    const llm = {
      available: true,
      chatJson: vi.fn().mockResolvedValue({
        intent: 'research',
        needsMemory: false,
        needsWebSearch: true,
        searchQueries: ['q1', 'q2', 'q3', 'q4', 'q5'],
        memoryQuery: null,
        entities: [],
        temporalHint: null,
        reasoning: 'test',
      }),
      chatStream: vi.fn().mockImplementation(async (_m, onToken: (t: string) => void) => {
        onToken('ok');
        return 'ok';
      }),
    } as unknown as OpenRouterClient;

    const orch = new AgentOrchestrator({
      memory,
      llm,
      search,
      maxToolIterations: 2,
    });

    const conv = memory.createConversation('Asia/Kolkata');
    await orch.handleTurn({
      conversationId: conv,
      userMessage: 'latest CRM pricing news',
      timezone: 'Asia/Kolkata',
      emit: () => undefined,
    });

    expect(calls).toBeLessThanOrEqual(2);
  });

  it('acknowledges missing historical evidence (Scenario E)', async () => {
    const search = new WebSearchTool(undefined);
    const llm = { available: false } as unknown as OpenRouterClient;
    const orch = new AgentOrchestrator({ memory, llm, search });
    const conv = memory.createConversation('Asia/Kolkata');
    const { events, emit } = collectEvents();

    const result = await orch.handleTurn({
      conversationId: conv,
      userMessage: 'What did I ask you last year?',
      timezone: 'Asia/Kolkata',
      emit,
    });

    expect(result.content).toMatch(/no (matching|stored)/i);
    const mem = events.find((e) => e.type === 'memory_used');
    expect(mem && mem.type === 'memory_used' && mem.messageCount === 0).toBe(true);
  });

  it('retrieves date-specific questions (Scenario B)', async () => {
    const older = memory.createConversation('Asia/Kolkata');
    memory.addMessage(
      older,
      'user',
      'Compare five CRM tools',
      undefined,
      '2026-11-03T05:00:00.000Z',
    );
    memory.addMessage(
      older,
      'assistant',
      'HubSpot, Salesforce, Pipedrive, Zoho, Freshsales',
      undefined,
      '2026-11-03T05:01:00.000Z',
    );

    const search = new WebSearchTool(undefined);
    const llm = { available: false } as unknown as OpenRouterClient;
    const orch = new AgentOrchestrator({ memory, llm, search });
    const conv = memory.createConversation('Asia/Kolkata');
    const result = await orch.handleTurn({
      conversationId: conv,
      userMessage: 'What did I ask you on 3 November?',
      timezone: 'Asia/Kolkata',
      emit: () => undefined,
    });

    expect(result.content).toMatch(/Compare five CRM tools/);
    expect(result.content).not.toMatch(/invent/i);
  });

  it('handles malformed model JSON via parseJsonResponse', () => {
    const parsed = parseJsonResponse(
      '```json\n{"intent":"casual","needsMemory":false,"needsWebSearch":false,"searchQueries":[],"entities":[]}\n```',
      intentSchema,
    );
    expect(parsed.intent).toBe('casual');
    expect(() => parseJsonResponse('not json', intentSchema)).toThrow();
  });

  it('removes citation ids that were not returned by web search', () => {
    const answer = validateCitationMarkers('Supported [1], fabricated [99].', [
      { id: 1, title: 'Source', url: 'https://example.com', snippet: 'Evidence' },
    ]);
    expect(answer).toBe('Supported [1], fabricated.');
  });
});

describe('hiring challenge scenarios', () => {
  it('Scenario A — recovers CRM shortlist and compares with web', async () => {
    const memory = new MemoryEngine(createTestDatabase());
    const past = memory.createConversation('Asia/Kolkata');
    memory.addMessage(
      past,
      'user',
      'We shortlisted HubSpot, Salesforce, Pipedrive, Zoho CRM, and Freshsales for a 20-person sales team.',
      undefined,
      '2026-11-09T08:00:00.000Z',
    );
    memory.addMessage(
      past,
      'assistant',
      'For 20 seats: HubSpot $20/user/mo, Salesforce $25/user/mo, Pipedrive $14/user/mo, Zoho $14/user/mo, Freshsales $15/user/mo.',
      undefined,
      '2026-11-09T08:01:00.000Z',
    );
    memory.extractHeuristicFacts(
      past,
      memory.getMessages(past)[1].id,
      memory.getMessages(past)[1].content,
      '2026-11-09T08:01:00.000Z',
    );

    const search = new WebSearchTool('key');
    vi.spyOn(search, 'execute').mockImplementation(async (raw) => {
      const q = String((raw as { query: string }).query);
      const product = ['HubSpot', 'Salesforce', 'Pipedrive', 'Zoho', 'Freshsales'].find((p) =>
        q.toLowerCase().includes(p.toLowerCase()),
      );
      return {
        query: q,
        searched: true,
        results: product
          ? [
              {
                title: `${product} Pricing`,
                url: `https://example.com/${product.toLowerCase()}`,
                content: `${product} starter pricing is $30 / month per user`,
                publishedDate: '2025-11-09',
                score: 0.9,
                source: 'tavily',
              },
            ]
          : [],
      };
    });

    const llm = {
      available: true,
      chatJson: vi.fn().mockResolvedValue({
        intent: 'verification',
        needsMemory: true,
        needsWebSearch: true,
        searchQueries: ['CRM pricing HubSpot Salesforce'],
        memoryQuery: 'CRM shortlist 20-person',
        entities: ['HubSpot', 'Salesforce', 'Pipedrive', 'Zoho', 'Freshsales'],
        temporalHint: 'Monday',
        reasoning: 'scenario A',
      }),
      chatStream: vi.fn().mockImplementation(async (_m, onToken: (t: string) => void) => {
        const text =
          'Recovered five CRMs for a 20-person team. Pricing appears changed for several vendors [1].';
        onToken(text);
        return text;
      }),
    } as unknown as OpenRouterClient;

    const orch = new AgentOrchestrator({
      memory,
      llm,
      search,
      maxToolIterations: 5,
      now: () => new Date('2026-11-10T12:00:00.000Z'),
    });
    const conv = memory.createConversation('Asia/Kolkata');
    const { events, emit } = collectEvents();
    const result = await orch.handleTurn({
      conversationId: conv,
      userMessage:
        'On Monday we shortlisted five CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?',
      timezone: 'Asia/Kolkata',
      emit,
    });

    const mem = events.find((e) => e.type === 'memory_used');
    expect(mem && mem.type === 'memory_used' && mem.messageCount).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'sources')).toBe(true);
    expect(events.some((e) => e.type === 'comparison')).toBe(true);
    expect(result.content).toMatch(/20-person|CRM|pricing/i);
  });

  it('Scenario C — Postgres hosting price comparison', async () => {
    const memory = new MemoryEngine(createTestDatabase());
    const past = memory.createConversation('Asia/Kolkata');
    // last Tuesday from 2026-11-10 perspective is 2026-11-03
    memory.addMessage(
      past,
      'user',
      'Compare Postgres hosting: Neon, Supabase, Railway',
      undefined,
      '2026-11-03T09:00:00.000Z',
    );
    memory.addMessage(
      past,
      'assistant',
      'Neon Launch $19/mo, Supabase Pro $25/mo, Railway Postgres about $5/mo starting.',
      undefined,
      '2026-11-03T09:01:00.000Z',
    );

    const search = new WebSearchTool('key');
    vi.spyOn(search, 'execute').mockResolvedValue({
      query: 'Neon pricing',
      searched: true,
      results: [
        {
          title: 'Neon Pricing',
          url: 'https://neon.tech/pricing',
          content: 'Neon Launch plan costs $25 / month',
          publishedDate: '2025-11-09',
          score: 1,
          source: 'tavily',
        },
      ],
    });

    const llm = {
      available: false,
    } as unknown as OpenRouterClient;

    const orch = new AgentOrchestrator({
      memory,
      llm,
      search,
      now: () => new Date('2026-11-10T12:00:00.000Z'),
    });
    const conv = memory.createConversation('Asia/Kolkata');
    const { events, emit } = collectEvents();
    await orch.handleTurn({
      conversationId: conv,
      userMessage: 'Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?',
      timezone: 'Asia/Kolkata',
      emit,
    });

    const comparison = events.find((e) => e.type === 'comparison');
    expect(comparison).toBeTruthy();
    if (comparison && comparison.type === 'comparison') {
      expect(comparison.findings.some((f) => f.subject.toLowerCase().includes('neon'))).toBe(true);
    }
  });
});
