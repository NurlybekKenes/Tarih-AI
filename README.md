# Тарих / Tarih

An early, runnable MVP for a bilingual guide to Kazakhstan’s history and culture. It includes a FastAPI knowledge API with cited demo data and a React/Vite frontend.

## Current scope

- FastAPI endpoints: `GET /health` plus versioned `/api/v1/periods`, `/api/v1/events`, `/api/v1/events/{slug}`, `/api/v1/search`, and `/api/v1/chat`. Previous `/api/...` routes remain available to the current frontend.
- Ten bilingual (`kk` / `ru`) records spanning archaeology, the medieval period, the Kazakh Khanate, late Soviet events, independence, diplomacy, and the national currency.
- Search over the prepared records. Chat answers only from matched records, returns source metadata built by the backend, and reports insufficient evidence when nothing matches.
- Local event/document retrieval is isolated behind `LocalRetriever` in `backend/app/retrieval.py`; the current `SQLiteFTSRetriever` uses lexical event matching and SQLite FTS5 document chunks. This is a replacement point for future PostgreSQL, vector, or hybrid retrieval; embeddings are not currently used.
- Optional OpenAI-compatible API configured through `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL`. The `LLMProvider` protocol and OpenAI-compatible adapter are isolated in `backend/app/providers.py`; new providers can implement the same interface without changing API routes. Without provider settings, the API uses an explicit deterministic `demo` mode. Provider failures return source excerpts in `fallback` mode.
- Optional live web search in the guide via Tavily (`TAVILY_API_KEY`). Chat can search only the local Tarih library, only the web, or both; web sources include a retrieval/check date and remain separate from the local library.
- Responsive React/Vite/Tailwind frontend with Kazakh/Russian interface toggle, search, timeline cards, source-linked detail dialog, and AI guide chat.
- SQLite-backed periods, events, sources, event-source links, and document chunks. SQL migrations and repeatable seeds run automatically when the API is used; local database files are ignored by Git.
- Protected import for UTF-8 `.txt` and `.md` documents (1 MB maximum), chunked and indexed through SQLite FTS5. User documents are marked as unreviewed and cannot invent an external source URL.
- Local document manager in the interface: upload, list, refresh, and delete imported files. The admin token is held in page memory and is sent only as a Bearer token to the local API.
- Protected editorial workflow for existing event cards: an admin can submit a bilingual revision, add reviewer notes, move it into review, request changes, or approve it. Public event content changes only when a revision is approved; revisions are stored separately in SQLite.
- PostgreSQL, pgvector, PDF/OCR ingestion, and semantic vector search are not yet implemented.

## Run locally

Python 3.10+ and Node.js 18+ are supported by the current implementation. Open two PowerShell windows from the project root.

Backend window:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --port 8000
```

Frontend window:

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL printed in the frontend window (normally `http://127.0.0.1:5173`). The Vite development proxy forwards API requests to `http://127.0.0.1:8000`. The API schema is at `http://127.0.0.1:8000/docs`; health is at `http://127.0.0.1:8000/health`.

The first API request applies SQL files from `backend/migrations/` and inserts the demonstration records into `backend/data/tarih.sqlite3`. To use a different local database file, set `TARIH_DATABASE_PATH` before starting the backend. The database is local runtime data and is not committed.

Open **Документы / Құжаттар** in the site navigation, enter the local `TARIH_ADMIN_TOKEN`, then upload a UTF-8 `.txt` or `.md` file and choose its language. The token is kept in page memory only. The panel lets you refresh the list and confirm before deleting an imported file.

To enable document import, keep `TARIH_ADMIN_TOKEN` in the local, Git-ignored `.env` file. Generate a token without printing it to the terminal:

```powershell
@'
from pathlib import Path
import secrets
p = Path('.env')
lines = p.read_text(encoding='utf-8').splitlines() if p.exists() else []
lines = [line for line in lines if not line.startswith('TARIH_ADMIN_TOKEN=')]
lines.append('TARIH_ADMIN_TOKEN=' + secrets.token_urlsafe(32))
p.write_text('\n'.join(lines) + '\n', encoding='utf-8')
'@ | python -
```

Restart the backend after changing `.env`. Import a text or Markdown file with a raw PUT request:

```powershell
$headers = @{ Authorization = "Bearer $env:TARIH_ADMIN_TOKEN" }
Invoke-RestMethod -Method Put -Uri "http://127.0.0.1:8000/api/v1/documents/history-notes?filename=history-notes.md&language=ru" -Headers $headers -ContentType "text/markdown; charset=utf-8" -InFile ".\history-notes.md"
```

Imported documents become searchable at `/api/v1/search?q=...&language=ru` and are available to the AI guide as explicitly unreviewed context. The interface supports upload, list, and delete. Import and management are disabled with HTTP 503 until the token is set; requests without the matching Bearer token receive HTTP 401. The local document body is stored in the SQLite database. `docs/data-sources.md` was previously imported as `source-catalog` and verified through full-text search; it is an existing project source catalog, not a newly submitted historical primary source.

The same local admin token opens historical-card editing in **Документы / Құжаттар**. Editing submits a revision rather than changing the public card. Reviewers can move it to review, request changes with a note, or approve it; approval updates the event and its source links atomically. The admin API is `GET /api/v1/admin/events`, `POST /api/v1/admin/events/{slug}/revisions`, `GET /api/v1/admin/events/{slug}/revisions`, and `PATCH /api/v1/admin/event-revisions/{id}/review`.

## Run with Docker Compose

Docker Engine with the Compose plugin is required. Copy `.env.example` to `.env`, fill optional provider keys as needed, then run from the project root:

```powershell
Copy-Item .env.example .env
docker compose up --build -d
```

Open `http://localhost:8080`. Nginx serves the frontend and proxies `/api` and `/health` to the API container. SQLite and uploaded document data persist in the `tarih_data` Docker volume. To stop the services while preserving data, run `docker compose down`; to remove the database too, run `docker compose down -v`. Compose exposes the web service on localhost only by default. The API has no host port mapping.

The `.env` file is private local configuration and is ignored by Git. Keep `TARIH_ADMIN_TOKEN` strong before enabling document imports or editorial actions. `TAVILY_API_KEY` and LLM settings are optional; without them, the demo/fallback behavior remains available.

## Deploy to Vercel

The repository is prepared for two Vercel projects connected to the same GitHub repository. This keeps the Vite frontend and FastAPI backend in their supported Vercel runtimes:

1. Create the frontend project and set **Root Directory** to `frontend`. Use the Vite preset, build command `npm run build`, and output directory `dist`.
2. Create the backend project from the same repository and set **Root Directory** to `backend`. Vercel detects the FastAPI app exported by `index.py` and installs `requirements.txt`.
3. In the backend project's environment variables, set `TARIH_DATABASE_PATH=/tmp/tarih.sqlite3`. Add `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, and `TAVILY_API_KEY` only when enabling those integrations. Keep `TARIH_ADMIN_TOKEN` unset until persistent storage and admin authentication are ready.
4. After the frontend's production domain is assigned, set backend `CORS_ORIGINS` to that exact origin (for example, `https://your-tarih-domain.vercel.app`). Set the frontend project's `VITE_API_BASE_URL` to the backend's production origin (for example, `https://your-tarih-api.vercel.app`) and set `VITE_ADMIN_UI_ENABLED=false` while storage is temporary; redeploy both projects.
5. Verify the backend at `/health` and `/docs`, then open the frontend and try timeline, search, and chat. Check backend deployment logs if Vercel returns a function error.

**Storage limitation:** `/tmp` is temporary function storage, can differ by serverless instance, and is not durable across cold starts or deployments. The seeded demo catalog can be recreated by migrations, but uploaded documents and approved editorial revisions must not be treated as persistent on Vercel. Do not enable document import or editorial writes for real users until the repository is moved to shared persistent storage such as PostgreSQL. This is a deployment-ready demo setup, not yet a production data configuration.

The UI reads the API origin from `VITE_API_BASE_URL`; leave it blank for the existing same-origin local Vite proxy. The backend allows the comma-separated exact origins in `CORS_ORIGINS`.

To enable internet search, set `TAVILY_API_KEY` in the backend `.env` and restart the backend. The key stays on the server. Without it, the guide continues with local sources and tells the user when a requested web search is unavailable. In chat, select **Tarih database**, **Internet**, or **Database + internet**. Internet search sends the question to Tavily; retrieved snippets are treated as untrusted evidence, and each result is shown in a separate Internet sources group with the date fetched. Tavily's official API uses `POST https://api.tavily.com/search` with Bearer authentication ([API overview](https://help.tavily.com/articles/4840311948-tavily-search-api)).

Copy `.env.example` to `.env` only if you want to configure an optional compatible AI endpoint. Do not commit secrets. An OpenRouter-compatible provider request was verified in a previous development session; repeat a live request after changing local credentials or model settings.

## Test

```powershell
python -m unittest discover -s backend/tests -v
```

The API tests use Python's built-in `unittest`, an isolated temporary SQLite database, and the already-required `httpx` ASGI transport.

## Sources and editorial notes

- [Kazakhstan’s 1991 independence law — Adilet, Kazakh](https://old.adilet.zan.kz/kaz/docs/Z910004400_): primary legal source for the date and declaration.
- [Kazakhstan — U.S. Department of State, Office of the Historian](https://history.state.gov/countries/kazakhstan/1000): corroborates U.S. recognition on 25 December 1991; it is not the source for the law’s date.
- [Kazakh Khanate — E-history.kz chronology](https://e-history.kz/ru/chronology/event/503): records Ablai Khan’s 1771–1781 rule.
- [History of the region — gov.kz](https://www.gov.kz/org/sko/press/article/details/1581): gives 1771–1781 as his period of rule as khan of the three Kazakh zhuzes.
- [Petroglyphs of the Archaeological Landscape of Tanbaly — UNESCO](https://whc.unesco.org/en/list/1145/): cultural landscape description and inscription information.
- [Establishment of the Kazakh Khanate — E-history.kz](https://e-history.kz/en/amp/history-of-kazakhstan/show/9553): formation associated with Kerei and Zhanibek; 1465–1466 is represented as a period, not a precise day.
- [Mausoleum of Khoja Ahmed Yasawi — UNESCO](https://whc.unesco.org/en/list/1103/): construction dates, patronage, and unfinished state.
- [Sovereignty declaration — Adilet](https://old.adilet.zan.kz/rus/docs/B900001700_): primary text of the 25 October 1990 Supreme Soviet act.
- [December 1986 events — E-history.kz](https://e-history.kz/kz/calendar/show/26108): date and short institutional historical account.
- [Semipalatinsk polygon closure — State Archive of West Kazakhstan Region](https://muragat-bko.gov.kz/ru/archive/catalog?delo=98101&doki=80473&fond=289&opis=1611): catalog record for decree No. 409 of 29 August 1991.
- [Kazakhstan and the UN — United Nations in Kazakhstan](https://kazakhstan.un.org/kk/download/5340/27316): admission date, 2 March 1992.
- [1993 banknotes — National Bank of Kazakhstan](https://nationalbank.kz/kz/news/banknoty/6787): records the 15 November 1993 introduction date.

Claims and dates in these new entries were checked against the cited institutional or primary records during this iteration. The Kazakh and Russian descriptions are concise editorial summaries, not a substitute for review by a professional historian and language editor. A reviewer handoff with all ten cards, sources, and edit/approval columns is in [docs/editorial-review.csv](docs/editorial-review.csv); review instructions and high-attention historical points are in [docs/editorial-review.md](docs/editorial-review.md). Professional human sign-off is pending. Imported user documents are not fact-checked. Approximate and contested historical dating is represented as a period or explicitly qualified.

## Next

The seed set now contains ten sourced events, and TXT/Markdown import plus SQLite FTS5 search are implemented. Next review bilingual content with a subject-matter editor and assess PostgreSQL when multiple users need shared/remote data. Add PDF ingestion and hybrid/vector retrieval only after source licensing and quality workflows are defined.
