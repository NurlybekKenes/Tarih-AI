CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS historical_periods (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title_kk TEXT NOT NULL,
    title_ru TEXT NOT NULL,
    start_year INTEGER,
    end_year INTEGER,
    description_kk TEXT NOT NULL DEFAULT '',
    description_ru TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS historical_events (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    period_id INTEGER REFERENCES historical_periods(id) ON DELETE SET NULL,
    date_from TEXT NOT NULL,
    date_to TEXT NOT NULL,
    date_precision TEXT NOT NULL,
    title_kk TEXT NOT NULL,
    title_ru TEXT NOT NULL,
    summary_kk TEXT NOT NULL,
    summary_ru TEXT NOT NULL,
    body_kk TEXT NOT NULL,
    body_ru TEXT NOT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_events_status_date ON historical_events(status, date_from);
CREATE INDEX IF NOT EXISTS ix_events_period ON historical_events(period_id);
CREATE INDEX IF NOT EXISTS ix_events_category ON historical_events(category);

CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    publisher TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT '',
    published_at TEXT,
    accessed_at TEXT,
    license TEXT,
    language TEXT NOT NULL DEFAULT '',
    reliability_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS event_sources (
    event_id INTEGER NOT NULL REFERENCES historical_events(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL DEFAULT 'citation',
    note TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (event_id, source_id)
);

CREATE TABLE IF NOT EXISTS document_chunks (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    language TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    embedding BLOB,
    UNIQUE (source_id, language, chunk_index)
);
