import { Router } from 'express';
import { z } from 'zod';
import type { MemoryEngine } from '../memory/engine.js';
import { env } from '../env.js';

export function conversationsRouter(memory: MemoryEngine): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ conversations: memory.listConversations() });
  });

  router.post('/', (req, res) => {
    const body = z
      .object({
        timezone: z.string().min(1).max(64).optional(),
        title: z.string().min(1).max(120).optional(),
      })
      .safeParse(req.body ?? {});

    if (!body.success) {
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }

    const id = memory.createConversation(
      body.data.timezone ?? env.DEFAULT_TIMEZONE,
      body.data.title ?? 'New conversation',
    );
    const conversation = memory.getConversation(id);
    res.status(201).json({ conversation });
  });

  router.get('/:id', (req, res) => {
    const conversation = memory.getConversation(req.params.id);
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    const messages = memory.getMessages(req.params.id);
    res.json({ conversation, messages });
  });

  router.get('/:id/messages', (req, res) => {
    const conversation = memory.getConversation(req.params.id);
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    res.json({ messages: memory.getMessages(req.params.id) });
  });

  return router;
}
