export type MessageRole = 'user' | 'assistant' | 'system';

export type ChangeClassification =
  | 'NEW'
  | 'CHANGED'
  | 'UNCHANGED'
  | 'DISCONTINUED'
  | 'UNKNOWN';

export type IntentType =
  | 'casual'
  | 'memory_recall'
  | 'date_recall'
  | 'verification'
  | 'research'
  | 'comparison';

export interface Citation {
  id: number;
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string | null;
}

export interface ConversationEvent {
  type: 'conversation';
  conversationId: string;
}

export interface StatusEvent {
  type: 'status';
  stage:
    | 'classifying'
    | 'retrieving_memory'
    | 'searching'
    | 'comparing'
    | 'generating'
    | 'persisting';
  message: string;
}

export interface TokenEvent {
  type: 'token';
  content: string;
}

/** Replaces the streamed draft after deterministic citation validation. */
export interface AnswerEvent {
  type: 'answer';
  content: string;
}

export interface SourcesEvent {
  type: 'sources';
  citations: Citation[];
}

export interface MemoryUsedEvent {
  type: 'memory_used';
  conversationIds: string[];
  messageCount: number;
  dateRange?: { from: string; to: string } | null;
}

export interface ComparisonEvent {
  type: 'comparison';
  findings: ComparisonFinding[];
}

export interface DoneEvent {
  type: 'done';
  messageId: string;
  conversationId: string;
}

export interface ErrorEvent {
  type: 'error';
  message: string;
  retryable: boolean;
}

export type StreamEvent =
  | ConversationEvent
  | StatusEvent
  | TokenEvent
  | AnswerEvent
  | SourcesEvent
  | MemoryUsedEvent
  | ComparisonEvent
  | DoneEvent
  | ErrorEvent;

export interface ComparisonFinding {
  subject: string;
  classification: ChangeClassification;
  historical?: string | null;
  current?: string | null;
  difference?: string | null;
  confidence: 'high' | 'medium' | 'low';
  notes?: string | null;
  sources: string[];
}

export interface ConversationSummaryDto {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  citations?: Citation[];
  metadata?: Record<string, unknown>;
}
