from __future__ import annotations

import os
import re
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Literal

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .providers import get_llm_provider
from .retrieval import SQLiteFTSRetriever
from .storage import (
    create_event_revision as db_create_event_revision,
    delete_document as db_delete_document,
    get_event as db_get_event,
    list_admin_events as db_list_admin_events,
    list_documents as db_list_documents,
    list_events as db_list_events,
    list_event_revisions as db_list_event_revisions,
    list_periods as db_list_periods,
    review_event_revision as db_review_event_revision,
    search_document_chunks as db_search_document_chunks,
    store_document as db_store_document,
)

load_dotenv()

app = FastAPI(title="Tarih API", version="0.1.0", description="Bilingual, source-grounded history guide")
allowed_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_methods=["GET", "POST", "PUT", "DELETE"], allow_headers=["Content-Type", "Authorization"])

_requests: dict[str, deque[float]] = defaultdict(deque)
_local_retriever = SQLiteFTSRetriever()


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    language: Literal["kk", "ru"] = "ru"
    research_scope: Literal["local", "web", "combined"] = "combined"


class EventRevisionPayload(BaseModel):
    date_from: str = Field(min_length=4, max_length=20)
    date_to: str = Field(min_length=4, max_length=20)
    date_precision: Literal["day", "day-range", "year-range", "approximate-period"]
    period_slug: str | None = Field(default=None, max_length=80)
    title_kk: str = Field(min_length=1, max_length=240)
    title_ru: str = Field(min_length=1, max_length=240)
    summary_kk: str = Field(min_length=1, max_length=1200)
    summary_ru: str = Field(min_length=1, max_length=1200)
    body_kk: str = Field(min_length=1, max_length=12000)
    body_ru: str = Field(min_length=1, max_length=12000)
    category: str = Field(min_length=1, max_length=60)
    source_ids: list[str] = Field(min_length=1, max_length=10)


class EventRevisionReview(BaseModel):
    review_status: Literal["in_review", "changes_requested", "approved"]
    reviewer_notes: str = Field(default="", max_length=4000)


@app.get("/health")
async def health():
    return {"status": "ok", "ai_mode": "openai-compatible" if get_llm_provider() else "demo", "web_search_configured": bool(os.getenv("TAVILY_API_KEY"))}


@app.get("/api/events")
@app.get("/api/v1/events")
async def list_events(
    language: Literal["kk", "ru"] = "ru",
    q: str = Query(default="", max_length=120),
    category: str | None = Query(default=None, max_length=60),
    period_id: int | None = Query(default=None, ge=1),
    limit: int = Query(default=100, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=10000),
):
    items, total = db_list_events(language, q, category, period_id, limit, offset)
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@app.get("/api/v1/periods")
async def list_periods(language: Literal["kk", "ru"] = "ru"):
    return {"items": db_list_periods(language)}


@app.get("/api/events/{slug}")
@app.get("/api/v1/events/{slug}")
async def get_event(slug: str, language: Literal["kk", "ru"] = "ru"):
    event = db_get_event(slug, language)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


@app.get("/api/search")
@app.get("/api/v1/search")
async def search(q: str = Query(min_length=1, max_length=120), language: Literal["kk", "ru"] = "ru"):
    items, total = db_list_events(language, q)
    documents, document_total = db_search_document_chunks(q, language)
    return {"items": items, "total": total, "limit": 100, "offset": 0, "documents": documents, "document_total": document_total}


@app.put("/api/v1/documents/{slug}", status_code=201)
async def import_document(
    slug: str,
    request: Request,
    filename: str = Query(min_length=1, max_length=180),
    language: Literal["kk", "ru"] = "ru",
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", slug):
        raise HTTPException(status_code=422, detail="Document slug must use lowercase letters, digits, and hyphens")
    safe_filename = filename.replace("\\", "/").rsplit("/", 1)[-1]
    if not safe_filename.lower().endswith((".txt", ".md")):
        raise HTTPException(status_code=415, detail="Only UTF-8 .txt and .md documents are supported")
    max_bytes = 1_000_000
    declared_size = request.headers.get("content-length")
    if declared_size and declared_size.isdigit() and int(declared_size) > max_bytes:
        raise HTTPException(status_code=413, detail="Document exceeds the 1 MB limit")
    raw = bytearray()
    async for part in request.stream():
        raw.extend(part)
        if len(raw) > max_bytes:
            raise HTTPException(status_code=413, detail="Document exceeds the 1 MB limit")
    try:
        content = bytes(raw).decode("utf-8-sig").strip()
    except UnicodeDecodeError as error:
        raise HTTPException(status_code=415, detail="Document must be UTF-8 encoded") from error
    if not content:
        raise HTTPException(status_code=422, detail="Document is empty")
    chunk_count = db_store_document(slug, safe_filename, language, content)
    return {"slug": slug, "filename": safe_filename, "language": language, "chunks": chunk_count, "indexed": True}


@app.get("/api/v1/documents")
async def list_imported_documents(authorization: str | None = Header(default=None)):
    require_admin(authorization)
    return {"items": db_list_documents()}


@app.delete("/api/v1/documents/{slug}")
async def remove_imported_document(slug: str, authorization: str | None = Header(default=None)):
    require_admin(authorization)
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", slug):
        raise HTTPException(status_code=422, detail="Document slug must use lowercase letters, digits, and hyphens")
    if not db_delete_document(slug):
        raise HTTPException(status_code=404, detail="Imported document not found")
    return {"slug": slug, "deleted": True}


@app.get("/api/v1/admin/events")
async def list_admin_events(authorization: str | None = Header(default=None)):
    require_admin(authorization)
    return {"items": db_list_admin_events()}


@app.get("/api/v1/admin/events/{slug}/revisions")
async def list_admin_event_revisions(slug: str, authorization: str | None = Header(default=None)):
    require_admin(authorization)
    revisions = db_list_event_revisions(slug)
    if revisions is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return {"items": revisions}


@app.post("/api/v1/admin/events/{slug}/revisions", status_code=201)
async def create_admin_event_revision(
    slug: str,
    payload: EventRevisionPayload,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", slug):
        raise HTTPException(status_code=422, detail="Event slug must use lowercase letters, digits, and hyphens")
    try:
        revision_id = db_create_event_revision(slug, payload.model_dump())
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    if revision_id is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return {"id": revision_id, "slug": slug, "review_status": "pending"}


@app.patch("/api/v1/admin/event-revisions/{revision_id}/review")
async def review_admin_event_revision(
    revision_id: int,
    payload: EventRevisionReview,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    result = db_review_event_revision(revision_id, payload.review_status, payload.reviewer_notes.strip())
    if result == "missing":
        raise HTTPException(status_code=404, detail="Event revision not found")
    if result == "already-approved":
        raise HTTPException(status_code=409, detail="An approved revision cannot be changed")
    if result == "must-be-in-review":
        raise HTTPException(status_code=409, detail="Move the revision to in_review before approving it")
    if result == "source-missing":
        raise HTTPException(status_code=409, detail="A referenced source no longer exists; submit a new revision with valid sources")
    return {"id": revision_id, "review_status": payload.review_status}


def require_admin(authorization: str | None) -> None:
    expected = os.getenv("TARIH_ADMIN_TOKEN", "")
    if not expected:
        raise HTTPException(status_code=503, detail="Document management is disabled until TARIH_ADMIN_TOKEN is configured")
    parts = authorization.split(maxsplit=1) if authorization else []
    supplied = parts[1].strip() if len(parts) == 2 and parts[0].lower() == "bearer" else ""
    if not secrets.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing admin token")


@app.post("/api/chat")
@app.post("/api/v1/chat")
async def chat(payload: ChatRequest, request: Request):
    now = time.monotonic()
    history = _requests[request.client.host if request.client else "unknown"]
    while history and now - history[0] > 60:
        history.popleft()
    if len(history) >= 10:
        raise HTTPException(status_code=429, detail="Too many questions. Please wait a minute.")
    history.append(now)
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="Question must not be blank")
    include_local = payload.research_scope in ("local", "combined")
    include_web = payload.research_scope in ("web", "combined")
    matches = []
    document_matches = []
    if include_local:
        retrieved = _local_retriever.retrieve(question, payload.language)
        matches = retrieved.events
        document_matches = retrieved.documents
    web_results: list[dict] = []
    web_search_unavailable = False
    if include_web:
        if os.getenv("TAVILY_API_KEY"):
            try:
                web_results = await search_web(question, payload.language)
            except (httpx.HTTPError, KeyError, ValueError, TypeError):
                web_search_unavailable = True
        else:
            web_search_unavailable = True
    sources_by_id = {source["id"]: source for event in matches for source in event["sources"]}
    for source in sources_by_id.values():
        source["origin"] = "local-library"
        source["checked_at"] = source.get("accessed_at")
    for document in document_matches:
        sources_by_id[document["source_id"]] = {
            "id": document["source_id"], "title": document["title"], "author": "User import",
            "publisher": document["publisher"], "url": "", "language": document["language"],
            "reliability_note": "Локальный документ пользователя; содержание и происхождение не проверены редактором.",
            "origin": "local-document", "checked_at": None,
        }
    checked_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for index, result in enumerate(web_results, start=1):
        sources_by_id[f"web-{index}"] = {
            "id": f"web-{index}", "title": result["title"], "author": "", "publisher": result.get("domain", "Internet"),
            "url": result["url"], "language": payload.language, "reliability_note": result.get("published_date") or "",
            "origin": "web", "checked_at": checked_at,
        }
    sources = list(sources_by_id.values())
    if not matches and not document_matches and not web_results:
        if web_search_unavailable:
            answer = ("Интернеттен іздеу қазір қолжетімсіз, ал жергілікті материалдарда сенімді жауап табылмады." if payload.language == "kk" else
                      "Интернет-поиск сейчас недоступен, а в локальных материалах надёжного ответа не найдено.")
        else:
            answer = ("Қолдағы материалдар бұл сұраққа сенімді жауап беруге жеткіліксіз. Сұрақты нақтылап көріңіз." if payload.language == "kk" else
                      "В выбранных материалах недостаточно сведений для надёжного ответа. Уточните вопрос или измените область поиска.")
        return {"answer": answer, "sources": [], "mode": "fallback", "insufficient_data": True, "web_search_unavailable": web_search_unavailable}

    # The deterministic demo answer is assembled only from cited records; no model is implied.
    provider = get_llm_provider()
    if provider is not None:
        try:
            answer = await provider.generate_answer(question, payload.language, matches, document_matches, web_results)
            mode = "openai-compatible"
        except (httpx.HTTPError, KeyError, ValueError, IndexError, TypeError):
            answer = "\n\n".join([*(f"{item['title']} — {item['summary']}" for item in matches), *(f"{item['title']} — {item['content']}" for item in document_matches), *(f"{item['title']} — {item['content']}" for item in web_results)])
            answer += ("\n\nСыртқы AI қызметі қолжетімсіз, сондықтан табылған дереккөздерден үзінділер берілді." if payload.language == "kk" else "\n\nВнешний AI-сервис недоступен, поэтому показаны выдержки из найденных источников.")
            mode = "fallback"
    else:
        answer = "\n\n".join([*(f"{item['title']} — {item['summary']}" for item in matches), *(f"{item['title']} — {item['content']}" for item in document_matches), *(f"{item['title']} — {item['content']}" for item in web_results)])
        answer += ("\n\nБұл — табылған материалдарға негізделген демо-жауап." if payload.language == "kk" else "\n\nЭто демонстрационный ответ по найденным материалам.")
        mode = "demo"
    if web_search_unavailable:
        answer += ("\n\nИнтернеттен іздеу қолжетімсіз; жергілікті дереккөздер ғана пайдаланылды." if payload.language == "kk" else "\n\nИнтернет-поиск недоступен; использованы только локальные материалы.")
    return {"answer": answer, "sources": sources, "mode": mode, "insufficient_data": False, "web_search_unavailable": web_search_unavailable}


async def search_web(question: str, language: str) -> list[dict]:
    query = question if language == "ru" else f"Қазақстан тарихы {question}"
    async with httpx.AsyncClient(timeout=12) as client:
        response = await client.post(
            "https://api.tavily.com/search",
            headers={"Authorization": f"Bearer {os.environ['TAVILY_API_KEY']}", "Content-Type": "application/json"},
            json={"query": query, "topic": "general", "search_depth": "basic", "max_results": 5, "include_answer": False},
        )
        response.raise_for_status()
        payload = response.json()
    results = []
    for result in payload.get("results", []):
        url = result.get("url", "")
        if not isinstance(url, str) or not url.startswith(("https://", "http://")):
            continue
        results.append({
            "title": str(result.get("title") or url)[:240], "url": url[:2000],
            "content": str(result.get("content") or "")[:1800],
            "published_date": result.get("published_date"),
            "domain": re.sub(r"^www\.", "", url.split("//", 1)[-1].split("/", 1)[0])[:120],
        })
    return results
