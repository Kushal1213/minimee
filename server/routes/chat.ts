import { Router } from 'express';
import type { MemoryEngine } from '../memory/engine.js';
import type { AgentOrchestrator } from '../agent/orchestrator.js';
import { chatRequestSchema } from '../schemas/index.js';
import { env } from '../env.js';
import type { StreamEvent } from '../../shared/types.js';

export function chatRouter(memory: MemoryEngine, orchestrator: AgentOrchestrator): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }

    const timezone = parsed.data.timezone ?? env.DEFAULT_TIMEZONE;
    let conversationId = parsed.data.conversationId ?? null;

    if (conversationId) {
      const existing = memory.getConversation(conversationId);
      if (!existing) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
    } else {
      conversationId = memory.createConversation(timezone);
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    const send = (event: StreamEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    send({ type: 'conversation', conversationId });

    try {
      await orchestrator.handleTurn({
        conversationId,
        userMessage: parsed.data.message,
        timezone,
        emit: send,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected server error';
      send({ type: 'error', message, retryable: true });
    } finally {
      res.end();
    }
  });

  return router;
}
