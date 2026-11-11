import { config } from 'dotenv';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

config();

const envSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  TAVILY_API_KEY: z.string().min(1).optional(),
  MODEL_NAME: z.string().default('openai/gpt-5-mini'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_PATH: z.string().default('./data/minimi.db'),
  DEFAULT_TIMEZONE: z.string().default('Asia/Kolkata'),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  MAX_TOOL_ITERATIONS: z.coerce.number().int().positive().max(10).default(6),
  SEARCH_RESULT_LIMIT: z.coerce.number().int().positive().default(5),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  throw new Error('Environment validation failed');
}

const data = parsed.data;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

export const env = {
  ...data,
  DATABASE_PATH: path.isAbsolute(data.DATABASE_PATH)
    ? data.DATABASE_PATH
    : path.resolve(projectRoot, data.DATABASE_PATH),
  hasOpenRouter: Boolean(data.OPENROUTER_API_KEY),
  hasTavily: Boolean(data.TAVILY_API_KEY),
};

export type Env = typeof env;
