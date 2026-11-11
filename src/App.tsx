import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createConversation,
  getConversation,
  getTimezone,
  listConversations,
  streamChat,
} from './api';
import type { ConversationSummaryDto } from '../shared/types';
import { MessageView, type UiMessage } from './components/MessageView';

const EXAMPLES = [
  {
    title: 'Historical recall',
    prompt:
      'On Monday we shortlisted five CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?',
  },
  {
    title: 'Date-specific memory',
    prompt: 'What did I ask you on 3 November?',
  },
  {
    title: 'Verify past answer',
    prompt: 'Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?',
  },
  {
    title: 'Casual question',
    prompt: 'What is the difference between SQL and NoSQL?',
  },
];

function formatUpdated(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function App() {
  const [conversations, setConversations] = useState<ConversationSummaryDto[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [lastFailed, setLastFailed] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const activeTitle = useMemo(() => {
    return conversations.find((c) => c.id === activeId)?.title ?? 'New conversation';
  }, [conversations, activeId]);

  const refreshConversations = useCallback(async () => {
    const list = await listConversations();
    setConversations(list);
  }, []);

  useEffect(() => {
    refreshConversations().catch(() => setError('Could not load conversations'));
  }, [refreshConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, statusText]);

  const loadConversation = async (id: string) => {
    setError(null);
    setSidebarOpen(false);
    const data = await getConversation(id);
    setActiveId(id);
    setMessages(
      data.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          citations: m.citations,
          findings: (m.metadata?.findings as UiMessage['findings']) ?? undefined,
          memoryUsed:
            typeof m.metadata?.memoryMessageCount === 'number'
              ? { messageCount: m.metadata.memoryMessageCount as number }
              : undefined,
          searching: Boolean(m.metadata?.searched),
        })),
    );
  };

  const startNew = async () => {
    setError(null);
    const c = await createConversation();
    await refreshConversations();
    setActiveId(c.id);
    setMessages([]);
    setSidebarOpen(false);
  };

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setError(null);
    setLastFailed(null);
    setInput('');
    setStatusText('Working…');

    const userId = `local-user-${Date.now()}`;
    const assistantId = `local-assistant-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', content: trimmed },
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        streaming: true,
      },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    let conversationId = activeId;
    let gotMemory = false;
    let searching = false;

    try {
      await streamChat(
        { conversationId, message: trimmed },
        {
          onEvent: (event) => {
            if (event.type === 'conversation') {
              conversationId = event.conversationId;
              setActiveId(event.conversationId);
              return;
            }
            if (event.type === 'status') {
              setStatusText(event.message);
              if (event.stage === 'searching') {
                searching = true;
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, searching: true } : m)),
                );
              }
              return;
            }
            if (event.type === 'memory_used') {
              gotMemory = true;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        memoryUsed: {
                          messageCount: event.messageCount,
                          dateRange: event.dateRange,
                        },
                      }
                    : m,
                ),
              );
              return;
            }
            if (event.type === 'sources') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, citations: event.citations, searching: true } : m,
                ),
              );
              return;
            }
            if (event.type === 'comparison') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, findings: event.findings } : m,
                ),
              );
              return;
            }
            if (event.type === 'token') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + event.content, streaming: true }
                    : m,
                ),
              );
              return;
            }
            if (event.type === 'answer') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: event.content } : m,
                ),
              );
              return;
            }
            if (event.type === 'error') {
              setError(event.message);
              setLastFailed(trimmed);
              return;
            }
            if (event.type === 'done') {
              conversationId = event.conversationId || conversationId;
              setActiveId(conversationId);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        id: event.messageId || m.id,
                        streaming: false,
                        searching: searching || Boolean(m.citations?.length),
                        memoryUsed: gotMemory
                          ? m.memoryUsed
                          : m.memoryUsed,
                      }
                    : m,
                ),
              );
            }
          },
        },
        controller.signal,
      );
      await refreshConversations();
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const msg = err instanceof Error ? err.message : 'Request failed';
        setError(msg);
        setLastFailed(trimmed);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: m.content || `Error: ${msg}`,
                  streaming: false,
                }
              : m,
          ),
        );
      }
    } finally {
      setBusy(false);
      setStatusText(null);
      abortRef.current = null;
    }
  };

  return (
    <div className="app">
      {sidebarOpen && <div className="backdrop" onClick={() => setSidebarOpen(false)} />}

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">Minimi</div>
          <div className="brand-sub">Research agent · {getTimezone()}</div>
        </div>
        <button className="new-chat" onClick={() => startNew().catch((e) => setError(String(e)))}>
          + New conversation
        </button>
        <div className="conversation-list">
          {conversations.map((c) => (
            <button
              key={c.id}
              className={`conversation-item ${c.id === activeId ? 'active' : ''}`}
              onClick={() => loadConversation(c.id).catch((e) => setError(String(e)))}
            >
              <span className="title">{c.title}</span>
              <span className="meta">
                {c.messageCount} msgs · {formatUpdated(c.updatedAt)}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <button className="menu-toggle" onClick={() => setSidebarOpen(true)}>
              Menu
            </button>
            <h1>{activeTitle}</h1>
          </div>
          <div className="hint">
            {statusText ?? 'Memory + web research with citations'}
          </div>
        </div>

        <div className="chat-scroll">
          {messages.length === 0 ? (
            <div className="empty">
              <h2>Ask with history in mind</h2>
              <p>
                Minimi remembers prior conversations, resolves dates in your timezone, and
                compares historical claims with current web evidence.
              </p>
              <div className="examples">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex.title}
                    className="example"
                    onClick={() => sendMessage(ex.prompt)}
                    disabled={busy}
                  >
                    <strong>{ex.title}</strong>
                    <span>{ex.prompt}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages">
              {messages.map((m) => (
                <MessageView key={m.id} message={m} />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="composer">
          {error && (
            <div className="error-banner">
              <span>{error}</span>
              {lastFailed && (
                <button
                  onClick={() => {
                    setError(null);
                    sendMessage(lastFailed);
                  }}
                >
                  Retry
                </button>
              )}
            </div>
          )}
          <form
            className="composer-inner"
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage(input);
            }}
          >
            <textarea
              value={input}
              placeholder="Ask a research question, or recall something from a past date…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              disabled={busy}
            />
            <button className="send" type="submit" disabled={busy || !input.trim()}>
              {busy ? '…' : 'Send'}
            </button>
          </form>
          <div className="credit">
            Built by <a href="https://github.com/Kushal1213" target="_blank" rel="noreferrer noopener">Kushal</a>
          </div>
        </div>
      </main>
    </div>
  );
}
