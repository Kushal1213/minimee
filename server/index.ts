import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';
import { getDb } from './db/client.js';
import { MemoryEngine } from './memory/engine.js';
import { OpenRouterClient } from './llm/openrouter.js';
import { WebSearchTool } from './tools/webSearch.js';
import { AgentOrchestrator } from './agent/orchestrator.js';
import { conversationsRouter } from './routes/conversations.js';
import { chatRouter } from './routes/chat.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(options?: {
  databasePath?: string;
  memory?: MemoryEngine;
  orchestrator?: AgentOrchestrator;
}) {
  const memory =
    options?.memory ?? new MemoryEngine(getDb(options?.databasePath ?? env.DATABASE_PATH));
  const llm = new OpenRouterClient();
  const search = new WebSearchTool();
  const orchestrator =
    options?.orchestrator ??
    new AgentOrchestrator({
      memory,
      llm,
      search,
      maxToolIterations: env.MAX_TOOL_ITERATIONS,
    });

  const app = express();

  app.use(
    cors({
      origin: env.NODE_ENV === 'production' ? false : true,
      credentials: false,
    }),
  );
  app.use(express.json({ limit: '256kb' }));

  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests' },
    }),
  );

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      model: env.MODEL_NAME,
      timezone: env.DEFAULT_TIMEZONE,
      openRouter: env.hasOpenRouter,
      tavily: env.hasTavily,
    });
  });

  app.use('/api/conversations', conversationsRouter(memory));
  app.use('/api/chat', chatRouter(memory, orchestrator));

  // Production static client
  const clientDir = path.resolve(__dirname, '../client');
  app.use(express.static(clientDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDir, 'index.html'), (err) => {
      if (err) next();
    });
  });

  return { app, memory, orchestrator };
}

if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
  const { app } = createApp();
  app.listen(env.PORT, () => {
    console.log(`Minimi research agent listening on http://localhost:${env.PORT}`);
    console.log(`Timezone: ${env.DEFAULT_TIMEZONE}`);
    console.log(`OpenRouter: ${env.hasOpenRouter ? 'configured' : 'missing'}`);
    console.log(`Tavily: ${env.hasTavily ? 'configured' : 'missing'}`);
  });
}
