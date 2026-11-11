import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Load via createRequire so Vite/Vitest does not try to bundle the built-in.
const sqlite = require('node:sqlite') as typeof import('node:sqlite');

export const DatabaseSync = sqlite.DatabaseSync;
export type AppDatabase = InstanceType<typeof DatabaseSync>;
