import { z } from 'zod';

export const chatRequestSchema = z.object({
  conversationId: z.string().uuid().optional().nullable(),
  message: z.string().min(1).max(8000),
  timezone: z.string().min(1).max(64).optional(),
});

export const intentSchema = z.object({
  intent: z.enum([
    'casual',
    'memory_recall',
    'date_recall',
    'verification',
    'research',
    'comparison',
  ]),
  needsMemory: z.boolean(),
  needsWebSearch: z.boolean(),
  searchQueries: z.array(z.string().min(1).max(200)).max(5).default([]),
  memoryQuery: z.string().max(400).optional().nullable(),
  entities: z.array(z.string().min(1).max(80)).max(15).default([]),
  temporalHint: z.string().max(120).optional().nullable(),
  reasoning: z.string().max(500).optional().nullable(),
});

export type IntentPlan = z.infer<typeof intentSchema>;

export const extractedFactSchema = z.object({
  subject: z.string().min(1).max(120),
  predicate: z.string().min(1).max(80),
  objectValue: z.string().min(1).max(400),
  factType: z.enum(['price', 'feature', 'preference', 'decision', 'claim', 'product', 'policy', 'other']),
  unit: z.string().max(40).optional().nullable(),
  confidence: z.number().min(0).max(1).default(0.7),
});

export const extractionSchema = z.object({
  entities: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        entityType: z.enum(['product', 'company', 'person', 'topic', 'other']),
      }),
    )
    .max(20)
    .default([]),
  facts: z.array(extractedFactSchema).max(30).default([]),
  summary: z.string().max(600).optional().nullable(),
});

export type ExtractionResult = z.infer<typeof extractionSchema>;

export const comparisonItemSchema = z.object({
  subject: z.string(),
  classification: z.enum(['NEW', 'CHANGED', 'UNCHANGED', 'DISCONTINUED', 'UNKNOWN']),
  historical: z.string().nullable().optional(),
  current: z.string().nullable().optional(),
  difference: z.string().nullable().optional(),
  confidence: z.enum(['high', 'medium', 'low']),
  notes: z.string().nullable().optional(),
  sources: z.array(z.string()).default([]),
});

export const comparisonSchema = z.object({
  findings: z.array(comparisonItemSchema).max(30),
});

export type ComparisonResult = z.infer<typeof comparisonSchema>;

export const webSearchArgsSchema = z.object({
  query: z.string().min(1).max(300),
  topic: z.enum(['general', 'news', 'finance']).optional().default('general'),
  searchDepth: z.enum(['basic', 'advanced']).optional().default('basic'),
});
