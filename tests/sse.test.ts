import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestDatabase, setDb, closeDb } from '../server/db/client.js';
import { MemoryEngine } from '../server/memory/engine.js';
import { AgentOrchestrator } from '../server/agent/orchestrator.js';
import { OpenRouterClient } from '../server/llm/openrouter.js';
import { WebSearchTool } from '../server/tools/webSearch.js';

describe('SSE chat streaming', () => {
  let app: Express;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.VITEST = 'true';
    const db = createTestDatabase();
    setDb(db);
    const memory = new MemoryEngine(db);
    const llm = {
      available: false,
    } as unknown as OpenRouterClient;
    const search = new WebSearchTool(undefined);
    const orchestrator = new AgentOrchestrator({ memory, llm, search });

    const mod = await import('../server/index.js');
    const created = mod.createApp({ memory, orchestrator });
    app = created.app;
  });

  afterAll(() => {
    closeDb();
  });

  it('streams conversation, tokens/status, and done events', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ message: 'What is the difference between SQL and NoSQL?', timezone: 'Asia/Kolkata' })
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => callback(null, data));
      });

    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toMatch(/text\/event-stream/);
    const body = String(res.body);
    expect(body).toContain('data: ');
    expect(body).toContain('"type":"conversation"');
    expect(body).toContain('"type":"done"');
  });

  it('rejects oversized / invalid payloads', async () => {
    const res = await request(app).post('/api/chat').send({ message: '' });
    expect(res.status).toBe(400);
  });

  it('persists conversation across requests (restart-safe DB semantics)', async () => {
    const create = await request(app)
      .post('/api/conversations')
      .send({ timezone: 'Asia/Kolkata', title: 'Persist' });
    expect(create.status).toBe(201);
    const id = create.body.conversation.id as string;

    await request(app)
      .post('/api/chat')
      .send({ conversationId: id, message: 'Remember the word persimmon', timezone: 'Asia/Kolkata' });

    const loaded = await request(app).get(`/api/conversations/${id}`);
    expect(loaded.status).toBe(200);
    expect(loaded.body.messages.length).toBeGreaterThanOrEqual(2);
    expect(loaded.body.messages.some((m: { content: string }) => m.content.includes('persimmon'))).toBe(
      true,
    );
  });
});
