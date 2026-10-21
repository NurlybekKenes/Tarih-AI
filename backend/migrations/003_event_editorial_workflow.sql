CREATE TABLE IF NOT EXISTS historical_event_revisions (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES historical_events(id) ON DELETE CASCADE,
    payload TEXT NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (review_status IN ('pending', 'in_review', 'changes_requested', 'approved')),
    reviewer_notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_event_revisions_event_created
    ON historical_event_revisions(event_id, created_at DESC, id DESC);
