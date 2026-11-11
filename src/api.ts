import type {
  ComparisonFinding,
  ConversationSummaryDto,
  MessageDto,
  StreamEvent,
} from '../shared/types';

const TIMEZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';

export function getTimezone(): string {
  return TIMEZONE;
}

export async function listConversations(): Promise<ConversationSummaryDto[]> {
  const res = await fetch('/api/conversations');
  if (!res.ok) throw new Error('Failed to load conversations');
  const data = (await res.json()) as { conversations: ConversationSummaryDto[] };
  return data.conversations;
}

export async function createConversation(): Promise<ConversationSummaryDto> {
  const res = await fetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timezone: TIMEZONE }),
  });
  if (!res.ok) throw new Error('Failed to create conversation');
  const data = (await res.json()) as { conversation: ConversationSummaryDto };
  return data.conversation;
}

export async function getConversation(
  id: string,
): Promise<{ conversation: ConversationSummaryDto; messages: MessageDto[] }> {
  const res = await fetch(`/api/conversations/${id}`);
  if (!res.ok) throw new Error('Failed to load conversation');
  return res.json();
}

export interface StreamHandlers {
  onEvent: (event: StreamEvent) => void;
  onError?: (error: Error) => void;
}

export async function streamChat(
  payload: { conversationId?: string | null; message: string },
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationId: payload.conversationId,
      message: payload.message,
      timezone: TIMEZONE,
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(text || `Chat request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const line = chunk
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith('data:'));
      if (!line) continue;
      try {
        const event = JSON.parse(line.slice(5).trim()) as StreamEvent;
        handlers.onEvent(event);
      } catch (err) {
        handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }
}

export type { ComparisonFinding, MessageDto, StreamEvent };
