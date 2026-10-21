# Architecture

```text
React/Vite UI → FastAPI routes → SQLite repository → local event/document retrieval ─┐
                   │                                                                 ├→ optional compatible LLM → answer + separated citations
                   └─ optional Tavily web search → dated, untrusted web snippets ───┘
```

The seed catalog has ten bilingual sourced events. SQL migrations create periods, events, sources, event-source relations, document chunks, editorial event revisions, and an SQLite FTS5 index; API access applies pending migrations and idempotently inserts seeds. `TARIH_DATABASE_PATH` can select another local file. The API supports `/api/v1` routes and retains the previous `/api` routes. Search combines event matching with full-text document chunks. The protected document manager accepts UTF-8 TXT/Markdown up to 1 MB and requires `TARIH_ADMIN_TOKEN` for upload, listing, and deletion; imported material is marked unreviewed. Historical-card edits are stored as revisions and leave the public card unchanged until an admin marks a revision approved. Approval updates the card and its source links in one SQLite transaction. The chat's `research_scope` selects `local`, `web`, or `combined`. Optional web results come from Tavily, are passed to the LLM as untrusted context, and receive a server retrieval timestamp. Each result is labelled `[W1]`, `[W2]`, etc. in both the prompt and the corresponding chat link so factual claims can be matched to sources. Local library sources and web sources are labelled separately in the response.

The `LLMProvider` protocol and `OpenAICompatibleProvider` adapter live in `backend/app/providers.py`, outside the HTTP route module. New model integrations can implement the protocol without changing chat routing or retrieval behavior. The current adapter uses the configured OpenAI-compatible chat-completions endpoint.

The `LocalRetriever` protocol and `SQLiteFTSRetriever` implementation live in `backend/app/retrieval.py`. The chat route receives ranked event matches and full-text document chunks through this boundary, which can later be backed by PostgreSQL FTS, pgvector, or a hybrid retriever without coupling those changes to the route or LLM adapter. Current retrieval remains lexical and does not use embeddings.

PostgreSQL and pgvector remain extension points until deployment or shared remote access requires them. PDF/OCR ingestion, document licensing metadata, and semantic vector search are not implemented. The document-management panel is intended for the local prototype; public deployment needs proper user authentication, role management, and storage/retention policy instead of a shared local admin token.
