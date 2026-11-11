import type { SQLInputValue } from 'node:sqlite';
import { v4 as uuidv4 } from 'uuid';
import type { AppDatabase } from '../db/client.js';
import type { Citation, MessageDto, MessageRole } from '../../shared/types.js';
import { dayRange, localDateString, nowIso, type DateRange } from './temporal.js';

export interface StoredMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

export interface MemoryFact {
  id: string;
  conversationId: string;
  messageId: string;
  entityId: string | null;
  factType: string;
  subject: string;
  predicate: string;
  objectValue: string;
  unit: string | null;
  validAt: string | null;
  observedAt: string;
  confidence: number;
  provenance: Record<string, unknown>;
  createdAt: string;
}

export interface MemoryEntity {
  id: string;
  conversationId: string;
  name: string;
  entityType: string;
  normalizedName: string;
  firstSeenAt: string;
  lastSeenAt: string;
  metadata: Record<string, unknown> | null;
}

export interface RetrievalResult {
  messages: StoredMessage[];
  facts: MemoryFact[];
  entities: MemoryEntity[];
  dateRange: DateRange | null;
  conversationIds: string[];
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function escapeFts(query: string): string {
  // Strip FTS operators and quote tokens for safe MATCH
  const tokens = query
    .replace(/["'*:(){}[\]^~]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1)
    .slice(0, 12);
  if (tokens.length === 0) return '""';
  return tokens.map((t) => `"${t}"`).join(' OR ');
}

export class MemoryEngine {
  constructor(private readonly db: AppDatabase) {}

  createConversation(timezone: string, title = 'New conversation'): string {
    const id = uuidv4();
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO conversations (id, title, timezone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, title, timezone, ts, ts);
    return id;
  }

  listConversations(): Array<{
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
  }> {
    return this.db
      .prepare(
        `SELECT c.id, c.title, c.created_at AS createdAt, c.updated_at AS updatedAt,
                (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS messageCount
         FROM conversations c
         ORDER BY c.updated_at DESC`,
      )
      .all() as Array<{
      id: string;
      title: string;
      createdAt: string;
      updatedAt: string;
      messageCount: number;
    }>;
  }

  getConversation(id: string): {
    id: string;
    title: string;
    timezone: string;
    createdAt: string;
    updatedAt: string;
  } | null {
    const row = this.db
      .prepare(
        `SELECT id, title, timezone, created_at AS createdAt, updated_at AS updatedAt
         FROM conversations WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          title: string;
          timezone: string;
          createdAt: string;
          updatedAt: string;
        }
      | undefined;
    return row ?? null;
  }

  updateConversationTitle(id: string, title: string): void {
    this.db
      .prepare(`UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?`)
      .run(title.slice(0, 120), nowIso(), id);
  }

  touchConversation(id: string): void {
    this.db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(nowIso(), id);
  }

  addMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
    metadata?: Record<string, unknown>,
    createdAt?: string,
  ): StoredMessage {
    const id = uuidv4();
    const ts = createdAt ?? nowIso();
    this.db
      .prepare(
        `INSERT INTO messages (id, conversation_id, role, content, created_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, conversationId, role, content, ts, metadata ? JSON.stringify(metadata) : null);
    this.touchConversation(conversationId);

    // Auto-title from first user message
    if (role === 'user') {
      const count = this.db
        .prepare(`SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ? AND role = 'user'`)
        .get(conversationId) as { c: number };
      if (count.c === 1) {
        this.updateConversationTitle(conversationId, content.trim().slice(0, 80));
      }
    }

    return {
      id,
      conversationId,
      role,
      content,
      createdAt: ts,
      metadata: metadata ?? null,
    };
  }

  getMessages(conversationId: string): MessageDto[] {
    const rows = this.db
      .prepare(
        `SELECT id, conversation_id AS conversationId, role, content, created_at AS createdAt, metadata_json
         FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`,
      )
      .all(conversationId) as Array<{
      id: string;
      conversationId: string;
      role: MessageRole;
      content: string;
      createdAt: string;
      metadata_json: string | null;
    }>;

    return rows.map((r) => {
      const metadata = parseJson<Record<string, unknown> | null>(r.metadata_json, null);
      return {
        id: r.id,
        conversationId: r.conversationId,
        role: r.role,
        content: r.content,
        createdAt: r.createdAt,
        citations: (metadata?.citations as Citation[] | undefined) ?? undefined,
        metadata: metadata ?? undefined,
      };
    });
  }

  getMessageById(id: string): StoredMessage | null {
    const r = this.db
      .prepare(
        `SELECT id, conversation_id AS conversationId, role, content, created_at AS createdAt, metadata_json
         FROM messages WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          conversationId: string;
          role: MessageRole;
          content: string;
          createdAt: string;
          metadata_json: string | null;
        }
      | undefined;
    if (!r) return null;
    return {
      id: r.id,
      conversationId: r.conversationId,
      role: r.role,
      content: r.content,
      createdAt: r.createdAt,
      metadata: parseJson(r.metadata_json, null),
    };
  }

  /** Retrieve messages for a local calendar date range (timezone-aware). */
  getMessagesByDateRange(
    range: DateRange,
    options?: { conversationId?: string; limit?: number },
  ): StoredMessage[] {
    const limit = options?.limit ?? 200;
    let sql = `
      SELECT id, conversation_id AS conversationId, role, content, created_at AS createdAt, metadata_json
      FROM messages
      WHERE created_at >= ? AND created_at < ?
    `;
    const params: SQLInputValue[] = [range.from, range.to];
    if (options?.conversationId) {
      sql += ` AND conversation_id = ?`;
      params.push(options.conversationId);
    }
    sql += ` ORDER BY created_at ASC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      conversationId: string;
      role: MessageRole;
      content: string;
      createdAt: string;
      metadata_json: string | null;
    }>;

    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversationId,
      role: r.role,
      content: r.content,
      createdAt: r.createdAt,
      metadata: parseJson(r.metadata_json, null),
    }));
  }

  /** Full-text search across messages with optional conversation isolation. */
  searchMessages(
    query: string,
    options?: { conversationId?: string; limit?: number; excludeConversationId?: string },
  ): StoredMessage[] {
    const limit = options?.limit ?? 20;
    const fts = escapeFts(query);
    if (fts === '""') return [];

    let sql = `
      SELECT m.id, m.conversation_id AS conversationId, m.role, m.content,
             m.created_at AS createdAt, m.metadata_json, bm25(messages_fts) AS rank
      FROM messages_fts
      JOIN messages m ON m.id = messages_fts.message_id
      WHERE messages_fts MATCH ?
    `;
    const params: SQLInputValue[] = [fts];

    if (options?.conversationId) {
      sql += ` AND m.conversation_id = ?`;
      params.push(options.conversationId);
    }
    if (options?.excludeConversationId) {
      // Still allow cross-conversation memory for research agent, but caller controls scope
    }

    sql += ` ORDER BY rank ASC, m.created_at DESC LIMIT ?`;
    params.push(limit);

    try {
      const rows = this.db.prepare(sql).all(...params) as Array<{
        id: string;
        conversationId: string;
        role: MessageRole;
        content: string;
        createdAt: string;
        metadata_json: string | null;
      }>;
      return rows.map((r) => ({
        id: r.id,
        conversationId: r.conversationId,
        role: r.role,
        content: r.content,
        createdAt: r.createdAt,
        metadata: parseJson(r.metadata_json, null),
      }));
    } catch {
      // Malformed FTS query — fall back to LIKE
      return this.fallbackLikeSearch(query, options);
    }
  }

  private fallbackLikeSearch(
    query: string,
    options?: { conversationId?: string; limit?: number },
  ): StoredMessage[] {
    const limit = options?.limit ?? 20;
    const tokens = query
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 2)
      .slice(0, 5);
    if (tokens.length === 0) return [];

    let sql = `SELECT id, conversation_id AS conversationId, role, content, created_at AS createdAt, metadata_json
               FROM messages WHERE 1=1`;
    const params: SQLInputValue[] = [];
    if (options?.conversationId) {
      sql += ` AND conversation_id = ?`;
      params.push(options.conversationId);
    }
    for (const t of tokens) {
      sql += ` AND content LIKE ?`;
      params.push(`%${t}%`);
    }
    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      conversationId: string;
      role: MessageRole;
      content: string;
      createdAt: string;
      metadata_json: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversationId,
      role: r.role,
      content: r.content,
      createdAt: r.createdAt,
      metadata: parseJson(r.metadata_json, null),
    }));
  }

  upsertEntity(
    conversationId: string,
    name: string,
    entityType: string,
    metadata?: Record<string, unknown>,
  ): MemoryEntity {
    const normalized = name.trim().toLowerCase();
    const existing = this.db
      .prepare(
        `SELECT id, conversation_id AS conversationId, name, entity_type AS entityType,
                normalized_name AS normalizedName, first_seen_at AS firstSeenAt,
                last_seen_at AS lastSeenAt, metadata_json
         FROM memory_entities
         WHERE conversation_id = ? AND normalized_name = ? AND entity_type = ?`,
      )
      .get(conversationId, normalized, entityType) as
      | {
          id: string;
          conversationId: string;
          name: string;
          entityType: string;
          normalizedName: string;
          firstSeenAt: string;
          lastSeenAt: string;
          metadata_json: string | null;
        }
      | undefined;

    const ts = nowIso();
    if (existing) {
      this.db
        .prepare(
          `UPDATE memory_entities SET last_seen_at = ?, metadata_json = COALESCE(?, metadata_json) WHERE id = ?`,
        )
        .run(ts, metadata ? JSON.stringify(metadata) : null, existing.id);
      return {
        id: existing.id,
        conversationId: existing.conversationId,
        name: existing.name,
        entityType: existing.entityType,
        normalizedName: existing.normalizedName,
        firstSeenAt: existing.firstSeenAt,
        lastSeenAt: ts,
        metadata: metadata ?? parseJson(existing.metadata_json, null),
      };
    }

    const id = uuidv4();
    this.db
      .prepare(
        `INSERT INTO memory_entities
         (id, conversation_id, name, entity_type, normalized_name, first_seen_at, last_seen_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        conversationId,
        name.trim(),
        entityType,
        normalized,
        ts,
        ts,
        metadata ? JSON.stringify(metadata) : null,
      );

    return {
      id,
      conversationId,
      name: name.trim(),
      entityType,
      normalizedName: normalized,
      firstSeenAt: ts,
      lastSeenAt: ts,
      metadata: metadata ?? null,
    };
  }

  addFact(input: {
    conversationId: string;
    messageId: string;
    entityId?: string | null;
    factType: string;
    subject: string;
    predicate: string;
    objectValue: string;
    unit?: string | null;
    validAt?: string | null;
    observedAt?: string;
    confidence?: number;
    provenance: Record<string, unknown>;
  }): MemoryFact {
    const id = uuidv4();
    const ts = nowIso();
    const observedAt = input.observedAt ?? ts;
    this.db
      .prepare(
        `INSERT INTO memory_facts
         (id, conversation_id, message_id, entity_id, fact_type, subject, predicate,
          object_value, unit, valid_at, observed_at, confidence, provenance_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.conversationId,
        input.messageId,
        input.entityId ?? null,
        input.factType,
        input.subject,
        input.predicate,
        input.objectValue,
        input.unit ?? null,
        input.validAt ?? null,
        observedAt,
        input.confidence ?? 0.7,
        JSON.stringify(input.provenance),
        ts,
      );

    return {
      id,
      conversationId: input.conversationId,
      messageId: input.messageId,
      entityId: input.entityId ?? null,
      factType: input.factType,
      subject: input.subject,
      predicate: input.predicate,
      objectValue: input.objectValue,
      unit: input.unit ?? null,
      validAt: input.validAt ?? null,
      observedAt,
      confidence: input.confidence ?? 0.7,
      provenance: input.provenance,
      createdAt: ts,
    };
  }

  getFactsBySubjects(subjects: string[], conversationId?: string): MemoryFact[] {
    if (subjects.length === 0) return [];
    const normalized = subjects.map((s) => s.toLowerCase());
    const placeholders = normalized.map(() => '?').join(',');
    let sql = `
      SELECT id, conversation_id AS conversationId, message_id AS messageId,
             entity_id AS entityId, fact_type AS factType, subject, predicate,
             object_value AS objectValue, unit, valid_at AS validAt,
             observed_at AS observedAt, confidence, provenance_json, created_at AS createdAt
      FROM memory_facts
      WHERE lower(subject) IN (${placeholders})
    `;
    const params: SQLInputValue[] = [...normalized];
    if (conversationId) {
      sql += ` AND conversation_id = ?`;
      params.push(conversationId);
    }
    sql += ` ORDER BY observed_at DESC`;

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      conversationId: string;
      messageId: string;
      entityId: string | null;
      factType: string;
      subject: string;
      predicate: string;
      objectValue: string;
      unit: string | null;
      validAt: string | null;
      observedAt: string;
      confidence: number;
      provenance_json: string;
      createdAt: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversationId,
      messageId: r.messageId,
      entityId: r.entityId,
      factType: r.factType,
      subject: r.subject,
      predicate: r.predicate,
      objectValue: r.objectValue,
      unit: r.unit,
      validAt: r.validAt,
      observedAt: r.observedAt,
      confidence: r.confidence,
      provenance: parseJson(r.provenance_json, {}),
      createdAt: r.createdAt,
    }));
  }

  getEntitiesForConversation(conversationId: string): MemoryEntity[] {
    const rows = this.db
      .prepare(
        `SELECT id, conversation_id AS conversationId, name, entity_type AS entityType,
                normalized_name AS normalizedName, first_seen_at AS firstSeenAt,
                last_seen_at AS lastSeenAt, metadata_json
         FROM memory_entities WHERE conversation_id = ? ORDER BY last_seen_at DESC`,
      )
      .all(conversationId) as Array<{
      id: string;
      conversationId: string;
      name: string;
      entityType: string;
      normalizedName: string;
      firstSeenAt: string;
      lastSeenAt: string;
      metadata_json: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversationId,
      name: r.name,
      entityType: r.entityType,
      normalizedName: r.normalizedName,
      firstSeenAt: r.firstSeenAt,
      lastSeenAt: r.lastSeenAt,
      metadata: parseJson(r.metadata_json, null),
    }));
  }

  saveDailySummary(
    conversationId: string,
    summaryDate: string,
    summaryText: string,
    messageIds: string[],
  ): void {
    const id = uuidv4();
    this.db
      .prepare(
        `INSERT INTO conversation_summaries
         (id, conversation_id, summary_date, summary_text, message_ids_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(conversation_id, summary_date) DO UPDATE SET
           summary_text = excluded.summary_text,
           message_ids_json = excluded.message_ids_json`,
      )
      .run(id, conversationId, summaryDate, summaryText, JSON.stringify(messageIds), nowIso());
  }

  getSummariesByDate(summaryDate: string): Array<{
    conversationId: string;
    summaryText: string;
    messageIds: string[];
  }> {
    const rows = this.db
      .prepare(
        `SELECT conversation_id AS conversationId, summary_text AS summaryText,
                message_ids_json AS messageIdsJson
         FROM conversation_summaries WHERE summary_date = ?`,
      )
      .all(summaryDate) as Array<{
      conversationId: string;
      summaryText: string;
      messageIdsJson: string;
    }>;
    return rows.map((r) => ({
      conversationId: r.conversationId,
      summaryText: r.summaryText,
      messageIds: parseJson(r.messageIdsJson, []),
    }));
  }

  /**
   * High-level retrieval combining date filters, FTS, and facts.
   * Never invents history — returns empty collections when nothing matches.
   */
  retrieve(options: {
    query: string;
    timezone: string;
    dateRange?: DateRange | null;
    conversationId?: string;
    searchAllConversations?: boolean;
    limit?: number;
  }): RetrievalResult {
    const limit = options.limit ?? 30;
    let messages: StoredMessage[] = [];

    if (options.dateRange) {
      messages = this.getMessagesByDateRange(options.dateRange, {
        conversationId: options.searchAllConversations ? undefined : options.conversationId,
        limit,
      });
    }

    // A date query is a hard temporal boundary. Do not merge unrestricted FTS hits,
    // which can otherwise pull similarly worded messages from unrelated dates.
    const ftsHits = options.dateRange
      ? []
      : this.searchMessages(options.query, {
          conversationId: options.searchAllConversations ? undefined : options.conversationId,
          limit,
        });

    // Merge by id, prefer chronological order
    const byId = new Map<string, StoredMessage>();
    for (const m of [...messages, ...ftsHits]) {
      byId.set(m.id, m);
    }
    const merged = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    // Expand with neighboring assistant/user turns in same conversation for context.
    // For date recall, neighbors must remain inside the requested interval as well.
    const expandedWithNeighbors = this.expandWithNeighbors(merged, 1);
    const expanded = options.dateRange
      ? expandedWithNeighbors.filter(
          (m) =>
            m.createdAt >= options.dateRange!.from &&
            m.createdAt < options.dateRange!.to,
        )
      : expandedWithNeighbors;

    const subjects = this.extractSubjectHints(options.query, expanded);
    const allFacts = this.getFactsBySubjects(
      subjects,
      options.searchAllConversations ? undefined : options.conversationId,
    );
    const facts = options.dateRange
      ? allFacts.filter(
          (f) =>
            f.observedAt >= options.dateRange!.from &&
            f.observedAt < options.dateRange!.to,
        )
      : allFacts;

    const conversationIds = [...new Set(expanded.map((m) => m.conversationId))];
    const entities = options.dateRange
      ? []
      : conversationIds.flatMap((cid) => this.getEntitiesForConversation(cid));

    return {
      messages: expanded.slice(0, limit),
      facts,
      entities,
      dateRange: options.dateRange ?? null,
      conversationIds,
    };
  }

  private expandWithNeighbors(messages: StoredMessage[], window: number): StoredMessage[] {
    const result = new Map<string, StoredMessage>();
    for (const m of messages) {
      result.set(m.id, m);
      const neighbors = this.db
        .prepare(
          `SELECT id, conversation_id AS conversationId, role, content, created_at AS createdAt, metadata_json
           FROM messages
           WHERE conversation_id = ?
           ORDER BY created_at ASC`,
        )
        .all(m.conversationId) as Array<{
        id: string;
        conversationId: string;
        role: MessageRole;
        content: string;
        createdAt: string;
        metadata_json: string | null;
      }>;
      const idx = neighbors.findIndex((n) => n.id === m.id);
      if (idx >= 0) {
        for (let i = Math.max(0, idx - window); i <= Math.min(neighbors.length - 1, idx + window); i++) {
          const n = neighbors[i];
          result.set(n.id, {
            id: n.id,
            conversationId: n.conversationId,
            role: n.role,
            content: n.content,
            createdAt: n.createdAt,
            metadata: parseJson(n.metadata_json, null),
          });
        }
      }
    }
    return [...result.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private extractSubjectHints(query: string, messages: StoredMessage[]): string[] {
    const hints = new Set<string>();
    const proper = query.match(/\b[A-Z][a-zA-Z0-9.+-]{1,}\b/g) ?? [];
    for (const p of proper) hints.add(p);
    // Also pull quoted product names from retrieved messages lightly
    for (const m of messages.slice(0, 10)) {
      const products = m.content.match(/\b([A-Z][a-zA-Z0-9.+-]{2,})\b/g) ?? [];
      for (const p of products.slice(0, 8)) hints.add(p);
    }
    return [...hints].slice(0, 20);
  }

  /** Lightweight heuristic extraction when LLM is unavailable or as supplement. */
  extractHeuristicFacts(
    conversationId: string,
    messageId: string,
    content: string,
    observedAt: string,
  ): MemoryFact[] {
    const facts: MemoryFact[] = [];
    const priceRe =
      /\b([A-Z][A-Za-z0-9.+-]{1,}(?:\s+[A-Z][A-Za-z0-9.+-]{1,}){0,2})\b[^.$\n]{0,40}?\$?\s?(\d+(?:\.\d+)?)\s*(?:\/\s*(mo|month|yr|year|user))?/gi;
    let match: RegExpExecArray | null;
    while ((match = priceRe.exec(content)) !== null) {
      const subject = match[1].trim();
      if (subject.length < 2) continue;
      const entity = this.upsertEntity(conversationId, subject, 'product');
      facts.push(
        this.addFact({
          conversationId,
          messageId,
          entityId: entity.id,
          factType: 'price',
          subject,
          predicate: 'priced_at',
          objectValue: match[2],
          unit: match[3] ? `USD/${match[3]}` : 'USD',
          observedAt,
          confidence: 0.55,
          provenance: {
            source: 'heuristic',
            messageId,
            excerpt: match[0].slice(0, 200),
          },
        }),
      );
    }

    // Entity mentions: CRM / product shortlists
    const listMatch = content.match(
      /(?:shortlisted|compared|looking at|considering|between)\s+([^.?!]+)/i,
    );
    if (listMatch) {
      const parts = listMatch[1]
        .split(/,| and | & /i)
        .map((s) => s.trim())
        .filter((s) => s.length > 1 && s.length < 40);
      for (const name of parts.slice(0, 10)) {
        this.upsertEntity(conversationId, name.replace(/[^A-Za-z0-9.+ -]/g, '').trim(), 'product');
      }
    }

    return facts;
  }

  buildDatedSummary(conversationId: string, timezone: string, messageIds?: string[]): void {
    const messages = this.getMessages(conversationId);
    if (messages.length === 0) return;

    const byDate = new Map<string, typeof messages>();
    for (const m of messages) {
      if (messageIds && !messageIds.includes(m.id)) continue;
      const d = localDateString(new Date(m.createdAt), timezone);
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push(m);
    }

    for (const [date, msgs] of byDate) {
      const userQs = msgs.filter((m) => m.role === 'user').map((m) => m.content.slice(0, 120));
      const summary =
        userQs.length > 0
          ? `Discussed: ${userQs.join(' | ')}`
          : msgs
              .map((m) => m.content.slice(0, 80))
              .join(' | ')
              .slice(0, 400);
      this.saveDailySummary(
        conversationId,
        date,
        summary,
        msgs.map((m) => m.id),
      );
    }
  }

  /** Recent turns for the active conversation (bounded context window). */
  getRecentContext(conversationId: string, limit = 8): StoredMessage[] {
    const rows = this.db
      .prepare(
        `SELECT id, conversation_id AS conversationId, role, content, created_at AS createdAt, metadata_json
         FROM messages WHERE conversation_id = ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(conversationId, limit) as Array<{
      id: string;
      conversationId: string;
      role: MessageRole;
      content: string;
      createdAt: string;
      metadata_json: string | null;
    }>;
    return rows
      .map((r) => ({
        id: r.id,
        conversationId: r.conversationId,
        role: r.role,
        content: r.content,
        createdAt: r.createdAt,
        metadata: parseJson(r.metadata_json, null),
      }))
      .reverse();
  }
}

export { dayRange };
