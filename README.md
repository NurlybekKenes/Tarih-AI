# Тарих / Tarih

An early, runnable MVP for a bilingual guide to Kazakhstan’s history and culture. It includes a FastAPI knowledge API with cited demo data and a React/Vite frontend.

## Current scope

- FastAPI endpoints: `GET /health`, `GET /api/events`, `GET /api/events/{slug}`, `GET /api/search`, `POST /api/chat`.
- Bilingual (`kk` / `ru`) records for Kazakhstan’s independence, Ablai Khan’s rule, and the Tanbaly archaeological landscape.
- Search over the prepared records. Chat answers only from matched records, returns source metadata built by the backend, and reports insufficient evidence when nothing matches.
- Optional OpenAI-compatible API configured through `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL`. Without those settings, the API uses an explicit deterministic `demo` mode. Provider failures return source excerpts in `fallback` mode.
- Responsive React/Vite/Tailwind frontend with Kazakh/Russian interface toggle, search, timeline cards, source-linked detail dialog, and AI guide chat.
- In-memory demo records; PostgreSQL, migrations, document ingestion, and vector search are not yet implemented.

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

Copy `.env.example` to `.env` only if you want to configure an optional compatible AI endpoint. Do not commit secrets. No real model request has been configured or made in this workspace.

## Test

```powershell
python -m unittest discover -s backend/tests -v
```

The API tests use Python's built-in `unittest` and the already-required `httpx` ASGI transport.

## Sources and editorial notes

- [Kazakhstan’s 1991 independence law — Adilet, Kazakh](https://old.adilet.zan.kz/kaz/docs/Z910004400_): primary legal source for the date and declaration.
- [Kazakhstan — U.S. Department of State, Office of the Historian](https://history.state.gov/countries/kazakhstan/1000): corroborates U.S. recognition on 25 December 1991; it is not the source for the law’s date.
- [Kazakh Khanate — E-history.kz chronology](https://e-history.kz/ru/chronology/event/503): records Ablai Khan’s 1771–1781 rule.
- [History of the region — gov.kz](https://www.gov.kz/org/sko/press/article/details/1581): gives 1771–1781 as his period of rule as khan of the three Kazakh zhuzes.
- [Petroglyphs of the Archaeological Landscape of Tanbaly — UNESCO](https://whc.unesco.org/en/list/1145/): cultural landscape description and inscription information.

The English metadata supplied by the source records has been summarized in Kazakh and Russian for this MVP. Have a subject-matter editor review the translations and historical wording before publication. Approximate prehistoric dating is represented as a broad period, not a precise date.

## Next

Add persistence and migrations. Extend the seed set with reviewed sources before expanding AI retrieval.
