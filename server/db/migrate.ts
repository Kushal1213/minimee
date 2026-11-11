import type { AppDatabase } from './client.js';

export function migrate(db: AppDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New conversation',
      timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
      ON messages(conversation_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_messages_created_at
      ON messages(created_at);

    CREATE TABLE IF NOT EXISTS conversation_summaries (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      summary_date TEXT NOT NULL,
      summary_text TEXT NOT NULL,
      message_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(conversation_id, summary_date)
    );

    CREATE INDEX IF NOT EXISTS idx_summaries_date
      ON conversation_summaries(summary_date);

    CREATE TABLE IF NOT EXISTS memory_entities (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      metadata_json TEXT,
      UNIQUE(conversation_id, normalized_name, entity_type)
    );

    CREATE INDEX IF NOT EXISTS idx_entities_name
      ON memory_entities(normalized_name);

    CREATE TABLE IF NOT EXISTS memory_facts (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      entity_id TEXT REFERENCES memory_entities(id) ON DELETE SET NULL,
      fact_type TEXT NOT NULL,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object_value TEXT NOT NULL,
      unit TEXT,
      valid_at TEXT,
      observed_at TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.7,
      provenance_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_facts_subject
      ON memory_facts(subject);

    CREATE INDEX IF NOT EXISTS idx_facts_conversation
      ON memory_facts(conversation_id, observed_at);

    CREATE INDEX IF NOT EXISTS idx_facts_message
      ON memory_facts(message_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      message_id UNINDEXED,
      conversation_id UNINDEXED,
      role UNINDEXED,
      content,
      created_at UNINDEXED,
      tokenize = 'porter unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(message_id, conversation_id, role, content, created_at)
      VALUES (new.id, new.conversation_id, new.role, new.content, new.created_at);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      DELETE FROM messages_fts WHERE message_id = old.id;
    END;

    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      DELETE FROM messages_fts WHERE message_id = old.id;
      INSERT INTO messages_fts(message_id, conversation_id, role, content, created_at)
      VALUES (new.id, new.conversation_id, new.role, new.content, new.created_at);
    END;
  `);
}
