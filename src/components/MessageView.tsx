import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Citation, ComparisonFinding } from '../../shared/types';

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  findings?: ComparisonFinding[];
  memoryUsed?: { messageCount: number; dateRange?: { from: string; to: string } | null };
  searching?: boolean;
  streaming?: boolean;
}

export function MessageView({ message }: { message: UiMessage }) {
  return (
    <div className={`message ${message.role}`}>
      <div className="role">{message.role === 'user' ? 'You' : 'Minimi'}</div>

      {message.role === 'assistant' && (message.memoryUsed || message.searching) && (
        <div className="status-row">
          {message.memoryUsed && message.memoryUsed.messageCount > 0 && (
            <span className="pill memory">
              Memory · {message.memoryUsed.messageCount} message
              {message.memoryUsed.messageCount === 1 ? '' : 's'}
            </span>
          )}
          {message.memoryUsed && message.memoryUsed.messageCount === 0 && (
            <span className="pill warn">Memory · no matches</span>
          )}
          {message.searching && <span className="pill search">Web research</span>}
        </div>
      )}

      <div className="bubble">
        {message.role === 'user' ? (
          message.content
        ) : (
          <div className="markdown">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noreferrer noopener">
                    {children}
                  </a>
                ),
              }}
            >
              {message.content || (message.streaming ? '…' : '')}
            </ReactMarkdown>
          </div>
        )}

        {message.findings && message.findings.length > 0 && (
          <div className="findings">
            {message.findings.map((f, i) => (
              <div className="finding" key={`${f.subject}-${i}`}>
                <strong>{f.subject}</strong> <code>{f.classification}</code>
                {f.historical ? ` · was ${f.historical}` : ''}
                {f.current ? ` · now ${f.current}` : ''}
                {f.difference ? ` · Δ ${f.difference}` : ''}
              </div>
            ))}
          </div>
        )}

        {message.citations && message.citations.length > 0 && (
          <div className="sources">
            <h4>Sources</h4>
            <div className="source-list">
              {message.citations.map((c) => (
                <a
                  key={c.id}
                  className="source-card"
                  href={c.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <div className="src-title">
                    [{c.id}] {c.title}
                  </div>
                  <div className="src-url">{c.url}</div>
                  {c.snippet && <div className="src-snippet">{c.snippet}</div>}
                  {c.publishedDate && (
                    <div className="src for-url" style={{ fontSize: '0.72rem', color: '#5c6a64' }}>
                      Published: {c.publishedDate}
                    </div>
                  )}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
