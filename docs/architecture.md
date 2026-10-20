# Architecture

```text
React/Vite UI → FastAPI routes → in-memory knowledge records → retrieval
                                            ├─ demo answer
                                            └─ optional compatible LLM → cited response
```

The initial implementation stores two reviewed demonstration records as bilingual Python data. API routes handle locale selection, search, validation, and a per-client chat rate limit. The chat endpoint matches user terms against the prepared event content. Sources are attached from backend records; generated model text cannot invent entries in the returned source list.

SQLite/PostgreSQL persistence, SQLAlchemy models, migrations, full-text indexing, pgvector, ingestion, and content administration are extension points only. They are not implemented in this MVP.
