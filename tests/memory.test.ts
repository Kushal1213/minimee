import { describe, expect, it, beforeEach } from 'vitest';
import { createTestDatabase } from '../server/db/client.js';
import { MemoryEngine } from '../server/memory/engine.js';
import { dayRange } from '../server/memory/temporal.js';

describe('MemoryEngine', () => {
  let memory: MemoryEngine;

  beforeEach(() => {
    memory = new MemoryEngine(createTestDatabase());
  });

  it('persists messages and survives reload from same db handle', () => {
    const id = memory.createConversation('Asia/Kolkata', 'Test');
    const msg = memory.addMessage(id, 'user', 'Hello memory');
    const loaded = memory.getMessages(id);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].content).toBe('Hello memory');
    expect(memory.getMessageById(msg.id)?.content).toBe('Hello memory');
  });

  it('isolates conversations', () => {
    const a = memory.createConversation('Asia/Kolkata');
    const b = memory.createConversation('Asia/Kolkata');
    memory.addMessage(a, 'user', 'secret from A');
    memory.addMessage(b, 'user', 'visible in B');
    expect(memory.getMessages(a).map((m) => m.content)).toEqual(['secret from A']);
    expect(memory.getMessages(b).map((m) => m.content)).toEqual(['visible in B']);
  });

  it('retrieves via FTS5', () => {
    const id = memory.createConversation('Asia/Kolkata');
    memory.addMessage(id, 'user', 'We shortlisted HubSpot Salesforce Pipedrive Zoho Freshsales');
    memory.addMessage(id, 'assistant', 'Here is a CRM comparison for a 20-person team.');
    memory.addMessage(id, 'user', 'unrelated weather chat');

    const hits = memory.searchMessages('CRM HubSpot pricing');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => /HubSpot|CRM/i.test(h.content))).toBe(true);
  });

  it('retrieves messages by local calendar date', () => {
    const id = memory.createConversation('Asia/Kolkata');
    // 3 Nov 2025 10:00 IST = 2025-11-03T04:30:00.000Z
    memory.addMessage(id, 'user', 'Question on Nov 3', undefined, '2025-11-03T04:30:00.000Z');
    memory.addMessage(
      id,
      'assistant',
      'Answer on Nov 3',
      undefined,
      '2025-11-03T04:31:00.000Z',
    );
    memory.addMessage(id, 'user', 'Question on Nov 4', undefined, '2025-11-04T04:30:00.000Z');

    const range = dayRange('2025-11-03', 'Asia/Kolkata');
    const msgs = memory.getMessagesByDateRange(range);
    expect(msgs).toHaveLength(2);
    expect(msgs.every((m) => m.content.includes('Nov 3'))).toBe(true);
  });


  it('keeps date-specific retrieval strictly inside the requested day', () => {
    const id = memory.createConversation('Asia/Kolkata');
    memory.addMessage(
      id,
      'user',
      'Compare HubSpot CRM pricing',
      undefined,
      '2025-11-03T04:30:00.000Z',
    );
    memory.addMessage(
      id,
      'assistant',
      'HubSpot CRM pricing was $20 per user',
      undefined,
      '2025-11-03T04:31:00.000Z',
    );
    memory.addMessage(
      id,
      'user',
      'HubSpot pricing follow-up on a different day',
      undefined,
      '2025-11-04T04:30:00.000Z',
    );

    const range = dayRange('2025-11-03', 'Asia/Kolkata');
    const result = memory.retrieve({
      query: 'HubSpot pricing',
      timezone: 'Asia/Kolkata',
      dateRange: range,
      searchAllConversations: true,
    });

    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages.every((m) => m.createdAt >= range.from && m.createdAt < range.to)).toBe(
      true,
    );
    expect(result.messages.some((m) => m.content.includes('different day'))).toBe(false);
  });

  it('stores facts with provenance to original messages', () => {
    const id = memory.createConversation('Asia/Kolkata');
    const msg = memory.addMessage(id, 'assistant', 'HubSpot is $20/user/mo');
    const entity = memory.upsertEntity(id, 'HubSpot', 'product');
    const fact = memory.addFact({
      conversationId: id,
      messageId: msg.id,
      entityId: entity.id,
      factType: 'price',
      subject: 'HubSpot',
      predicate: 'priced_at',
      objectValue: '20',
      unit: 'USD/user/mo',
      observedAt: msg.createdAt,
      provenance: { source: 'test', messageId: msg.id },
    });

    const facts = memory.getFactsBySubjects(['HubSpot']);
    expect(facts).toHaveLength(1);
    expect(facts[0].messageId).toBe(msg.id);
    expect(facts[0].provenance).toMatchObject({ source: 'test' });
    expect(fact.objectValue).toBe('20');
  });

  it('does not invent history when retrieval misses', () => {
    memory.createConversation('Asia/Kolkata');
    const result = memory.retrieve({
      query: 'What did I ask last year about quantum rockets',
      timezone: 'Asia/Kolkata',
      searchAllConversations: true,
    });
    expect(result.messages).toHaveLength(0);
    expect(result.facts).toHaveLength(0);
  });

  it('builds dated summaries without replacing original messages', () => {
    const id = memory.createConversation('Asia/Kolkata');
    const m = memory.addMessage(
      id,
      'user',
      'Tell me about Postgres hosting',
      undefined,
      '2025-11-04T10:00:00.000Z',
    );
    memory.buildDatedSummary(id, 'Asia/Kolkata');
    const summaries = memory.getSummariesByDate('2025-11-04');
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries[0].messageIds).toContain(m.id);
    // Original still intact
    expect(memory.getMessageById(m.id)?.content).toBe('Tell me about Postgres hosting');
  });
});
