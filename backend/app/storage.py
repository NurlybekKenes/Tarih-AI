"""Small SQLite repository and migration runner for the local Tarih knowledge base."""

from __future__ import annotations

import os
import re
import sqlite3
import json
from contextlib import closing
from pathlib import Path

from .data import EVENTS, SOURCES

BACKEND_ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = BACKEND_ROOT / "migrations"
DEFAULT_DB = BACKEND_ROOT / "data" / "tarih.sqlite3"

PERIODS = [
    {"slug": "ancient-history", "title_kk": "Ежелгі тарих", "title_ru": "Древняя история", "start_year": -2000, "end_year": 500, "description_kk": "Қазақстан аумағындағы көне мәдениеттер.", "description_ru": "Древние культуры на территории Казахстана.", "sort_order": 1},
    {"slug": "medieval-kazakhstan", "title_kk": "Орта ғасырлардағы Қазақстан", "title_ru": "Средневековый Казахстан", "start_year": 500, "end_year": 1464, "description_kk": "Қазақстан аумағындағы ортағасырлық мемлекеттер мен мәдениеттер.", "description_ru": "Средневековые государства и культуры на территории Казахстана.", "sort_order": 2},
    {"slug": "kazakh-khanate", "title_kk": "Қазақ хандығы", "title_ru": "Казахское ханство", "start_year": 1465, "end_year": 1847, "description_kk": "Қазақ хандығының қалыптасуы мен дамуы.", "description_ru": "Становление и развитие Казахского ханства.", "sort_order": 3},
    {"slug": "late-soviet-transition", "title_kk": "Кеңес дәуірінің соңғы кезеңі", "title_ru": "Позднесоветский период", "start_year": 1986, "end_year": 1990, "description_kk": "Қоғамдық және саяси өзгерістер кезеңі.", "description_ru": "Период общественных и политических перемен.", "sort_order": 4},
    {"slug": "modern-kazakhstan", "title_kk": "Қазіргі Қазақстан", "title_ru": "Современный Казахстан", "start_year": 1991, "end_year": None, "description_kk": "Тәуелсіз Қазақстанның тарихы.", "description_ru": "История независимого Казахстана.", "sort_order": 5},
]
EVENT_PERIOD = {
    "abilai-khan-reign": "kazakh-khanate", "kazakhstan-independence": "modern-kazakhstan",
    "kazakh-khanate-formation": "kazakh-khanate", "yasawi-mausoleum": "medieval-kazakhstan",
    "state-sovereignty-declaration": "late-soviet-transition", "zheltoksan-events": "late-soviet-transition",
    "semipalatinsk-test-site-closure": "modern-kazakhstan", "kazakhstan-un-membership": "modern-kazakhstan",
    "tenge-introduction": "modern-kazakhstan",
}


def _database_path() -> Path:
    raw = os.getenv("TARIH_DATABASE_PATH")
    if raw:
        return Path(raw).expanduser().resolve()
    if os.getenv("VERCEL"):
        # Vercel's deployed filesystem is read-only except for temporary /tmp storage.
        return Path("/tmp/tarih.sqlite3")
    return DEFAULT_DB


def connect() -> sqlite3.Connection:
    path = _database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    _migrate(db)
    _seed(db)
    return db


def _migrate(db: sqlite3.Connection) -> None:
    db.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
    applied = {row[0] for row in db.execute("SELECT version FROM schema_migrations")}
    for migration in sorted(MIGRATIONS.glob("*.sql")):
        if migration.name in applied:
            continue
        db.executescript(migration.read_text(encoding="utf-8"))
        db.execute("INSERT INTO schema_migrations(version) VALUES (?)", (migration.name,))
        db.commit()


def _seed(db: sqlite3.Connection) -> None:
    for period in PERIODS:
        db.execute("""INSERT OR IGNORE INTO historical_periods
            (slug,title_kk,title_ru,start_year,end_year,description_kk,description_ru,sort_order)
            VALUES (:slug,:title_kk,:title_ru,:start_year,:end_year,:description_kk,:description_ru,:sort_order)""", period)
    period_ids = {row["slug"]: row["id"] for row in db.execute("SELECT id,slug FROM historical_periods")}
    for source in SOURCES.values():
        db.execute("""INSERT OR IGNORE INTO sources (id,title,author,publisher,url,source_type,language,reliability_note)
            VALUES (:id,:title,:author,:publisher,:url,:source_type,:language,:reliability_note)""", source)
    for event in EVENTS:
        values = {**event, "period_id": period_ids.get(EVENT_PERIOD.get(event["slug"]))}
        db.execute("""INSERT OR IGNORE INTO historical_events
            (slug,period_id,date_from,date_to,date_precision,title_kk,title_ru,summary_kk,summary_ru,body_kk,body_ru,category,status)
            VALUES (:slug,:period_id,:date_from,:date_to,:date_precision,:title_kk,:title_ru,:summary_kk,:summary_ru,:body_kk,:body_ru,:category,'published')""", values)
    event_ids = {row["slug"]: row["id"] for row in db.execute("SELECT id,slug FROM historical_events")}
    for event in EVENTS:
        for source_id in event["sources"]:
            db.execute("INSERT OR IGNORE INTO event_sources(event_id,source_id) VALUES (?,?)", (event_ids[event["slug"]], source_id))
    db.commit()


def list_periods(language: str) -> list[dict]:
    title = "title_kk" if language == "kk" else "title_ru"
    description = "description_kk" if language == "kk" else "description_ru"
    with closing(connect()) as db:
        rows = db.execute(f"SELECT id,slug,{title} AS title,start_year,end_year,{description} AS description,sort_order FROM historical_periods ORDER BY sort_order,id").fetchall()
    return [dict(row) for row in rows]


def list_events(language: str, query: str = "", category: str | None = None, period_id: int | None = None, limit: int = 100, offset: int = 0) -> tuple[list[dict], int]:
    conditions = ["e.status = 'published'"]
    params: list[object] = []
    if category:
        conditions.append("e.category = ?"); params.append(category)
    if period_id is not None:
        conditions.append("e.period_id = ?"); params.append(period_id)
    where = " AND ".join(conditions)
    with closing(connect()) as db:
        rows = db.execute(f"SELECT e.*, p.slug AS period_slug FROM historical_events e LEFT JOIN historical_periods p ON p.id=e.period_id WHERE {where} ORDER BY e.date_from,e.id", params).fetchall()
        filtered = []
        needle = query.strip().casefold()
        for row in rows:
            if needle and not any(needle in str(row[key]).casefold() for key in ("title_kk", "title_ru", "summary_kk", "summary_ru", "body_kk", "body_ru")):
                continue
            filtered.append(_event_from_row(db, row, language))
    return filtered[offset:offset + limit], len(filtered)


def get_event(slug: str, language: str) -> dict | None:
    with closing(connect()) as db:
        row = db.execute("SELECT e.*,p.slug AS period_slug FROM historical_events e LEFT JOIN historical_periods p ON p.id=e.period_id WHERE e.slug=? AND e.status='published'", (slug,)).fetchone()
        return _event_from_row(db, row, language) if row else None


def list_admin_events() -> list[dict]:
    with closing(connect()) as db:
        rows = db.execute("""SELECT e.*,p.slug AS period_slug FROM historical_events e
            LEFT JOIN historical_periods p ON p.id=e.period_id ORDER BY e.date_from,e.id""").fetchall()
        events = []
        for row in rows:
            item = dict(row)
            item["source_ids"] = [source[0] for source in db.execute(
                "SELECT source_id FROM event_sources WHERE event_id=? ORDER BY source_id", (row["id"],)
            )]
            events.append(item)
    return events


def create_event_revision(slug: str, payload: dict) -> int | None:
    source_ids = list(dict.fromkeys(payload["source_ids"]))
    with closing(connect()) as db:
        event = db.execute("SELECT id FROM historical_events WHERE slug=?", (slug,)).fetchone()
        if event is None:
            return None
        valid_sources = {row[0] for row in db.execute(
            f"SELECT id FROM sources WHERE id IN ({','.join('?' for _ in source_ids)})", source_ids
        )} if source_ids else set()
        if valid_sources != set(source_ids):
            raise ValueError("Every source_id must refer to an existing source")
        period_slug = payload.get("period_slug")
        if period_slug and db.execute("SELECT 1 FROM historical_periods WHERE slug=?", (period_slug,)).fetchone() is None:
            raise ValueError("period_slug must refer to an existing period")
        cursor = db.execute("""INSERT INTO historical_event_revisions(event_id,payload)
            VALUES (?,?)""", (event["id"], json.dumps({**payload, "source_ids": source_ids}, ensure_ascii=False)))
        db.commit()
        return int(cursor.lastrowid)


def list_event_revisions(slug: str) -> list[dict] | None:
    with closing(connect()) as db:
        event = db.execute("SELECT id FROM historical_events WHERE slug=?", (slug,)).fetchone()
        if event is None:
            return None
        rows = db.execute("""SELECT id,review_status,reviewer_notes,created_at,reviewed_at,payload
            FROM historical_event_revisions WHERE event_id=? ORDER BY created_at DESC,id DESC""", (event["id"],)).fetchall()
    revisions = []
    for row in rows:
        item = dict(row)
        item["payload"] = json.loads(item["payload"])
        revisions.append(item)
    return revisions


def review_event_revision(revision_id: int, review_status: str, reviewer_notes: str) -> str:
    with closing(connect()) as db:
        revision = db.execute("""SELECT r.*,e.slug FROM historical_event_revisions r
            JOIN historical_events e ON e.id=r.event_id WHERE r.id=?""", (revision_id,)).fetchone()
        if revision is None:
            return "missing"
        if revision["review_status"] == "approved":
            return "already-approved"
        if review_status == "approved" and revision["review_status"] != "in_review":
            return "must-be-in-review"
        if review_status == "approved":
            payload = json.loads(revision["payload"])
            source_ids = payload["source_ids"]
            valid_sources = {row[0] for row in db.execute(
                f"SELECT id FROM sources WHERE id IN ({','.join('?' for _ in source_ids)})", source_ids
            )} if source_ids else set()
            if valid_sources != set(source_ids):
                return "source-missing"
            period = db.execute("SELECT id FROM historical_periods WHERE slug=?", (payload.get("period_slug"),)).fetchone() if payload.get("period_slug") else None
            db.execute("""UPDATE historical_events SET period_id=?,date_from=?,date_to=?,date_precision=?,
                title_kk=?,title_ru=?,summary_kk=?,summary_ru=?,body_kk=?,body_ru=?,category=?,
                status='published',updated_at=CURRENT_TIMESTAMP WHERE id=?""",
                (period["id"] if period else None, payload["date_from"], payload["date_to"], payload["date_precision"],
                 payload["title_kk"], payload["title_ru"], payload["summary_kk"], payload["summary_ru"],
                 payload["body_kk"], payload["body_ru"], payload["category"], revision["event_id"]))
            db.execute("DELETE FROM event_sources WHERE event_id=?", (revision["event_id"],))
            db.executemany("INSERT INTO event_sources(event_id,source_id) VALUES (?,?)",
                            [(revision["event_id"], source_id) for source_id in source_ids])
        db.execute("""UPDATE historical_event_revisions SET review_status=?,reviewer_notes=?,
            reviewed_at=CASE WHEN ? IN ('approved','changes_requested') THEN CURRENT_TIMESTAMP ELSE reviewed_at END
            WHERE id=?""", (review_status, reviewer_notes, review_status, revision_id))
        db.commit()
    return "ok"


def _fts_expression(query: str) -> str:
    terms = re.findall(r"[^\W_]+", query.casefold(), flags=re.UNICODE)[:12]
    return " OR ".join(f'"{term.replace(chr(34), chr(34) * 2)}"' for term in terms)


def search_document_chunks(query: str, language: str, limit: int = 10) -> tuple[list[dict], int]:
    expression = _fts_expression(query)
    if not expression:
        return [], 0
    with closing(connect()) as db:
        total = db.execute("""SELECT count(*) FROM document_chunks_fts f
            JOIN document_chunks c ON c.id=f.rowid
            WHERE document_chunks_fts MATCH ? AND c.language=?""", (expression, language)).fetchone()[0]
        rows = db.execute("""SELECT c.source_id,c.chunk_index,c.content,s.title,s.publisher,s.language,
            snippet(document_chunks_fts,0,'','', ' … ',18) AS excerpt
            FROM document_chunks_fts f JOIN document_chunks c ON c.id=f.rowid
            JOIN sources s ON s.id=c.source_id
            WHERE document_chunks_fts MATCH ? AND c.language=?
            ORDER BY bm25(document_chunks_fts) LIMIT ?""", (expression, language, limit)).fetchall()
    return [dict(row) for row in rows], total


def store_document(slug: str, filename: str, language: str, content: str) -> int:
    source_id = f"user-doc:{slug}"
    chunks = _chunk_text(content)
    with closing(connect()) as db:
        db.execute("""INSERT INTO sources (id,title,author,publisher,url,source_type,language,reliability_note)
            VALUES (?,?,?,'Локальный импорт','', 'user-provided-document',?,?)
            ON CONFLICT(id) DO UPDATE SET title=excluded.title,language=excluded.language,reliability_note=excluded.reliability_note,created_at=CURRENT_TIMESTAMP""",
            (source_id, filename, "User import", language, "Локальный документ пользователя; содержание и происхождение источника не проверены редактором."))
        db.execute("DELETE FROM document_chunks WHERE source_id=?", (source_id,))
        db.executemany("""INSERT INTO document_chunks(source_id,language,chunk_index,content,metadata)
            VALUES (?,?,?,?,?)""", [(source_id, language, index, chunk, json.dumps({"filename": filename}, ensure_ascii=False)) for index, chunk in enumerate(chunks)])
        db.commit()
    return len(chunks)


def list_documents() -> list[dict]:
    with closing(connect()) as db:
        rows = db.execute("""SELECT s.id,s.title,s.language,s.created_at,COUNT(c.id) AS chunks,
            MAX(c.metadata) AS metadata FROM sources s
            JOIN document_chunks c ON c.source_id=s.id
            WHERE s.source_type='user-provided-document'
            GROUP BY s.id ORDER BY s.created_at DESC,s.id""").fetchall()
    documents = []
    for row in rows:
        item = dict(row)
        metadata = json.loads(item.pop("metadata") or "{}")
        item["slug"] = item["id"].removeprefix("user-doc:")
        item["filename"] = metadata.get("filename", item["title"])
        documents.append(item)
    return documents


def delete_document(slug: str) -> bool:
    with closing(connect()) as db:
        cursor = db.execute("DELETE FROM sources WHERE id=? AND source_type='user-provided-document'", (f"user-doc:{slug}",))
        db.commit()
        return cursor.rowcount > 0


def _chunk_text(content: str, max_chars: int = 1200, overlap: int = 120) -> list[str]:
    chunks: list[str] = []
    start = 0
    while start < len(content):
        end = min(start + max_chars, len(content))
        if end < len(content):
            boundary = max(content.rfind("\n\n", start, end), content.rfind(". ", start, end), content.rfind(" ", start, end))
            if boundary > start + max_chars // 2:
                end = boundary + 1
        part = content[start:end].strip()
        if part:
            chunks.append(part)
        if end >= len(content):
            break
        start = max(start + 1, end - overlap)
    return chunks


def _event_from_row(db: sqlite3.Connection, row: sqlite3.Row, language: str) -> dict:
    item = dict(row)
    fallback = False
    for field in ("title", "summary", "body"):
        primary = item[f"{field}_{language}"]
        item[field] = primary or item[f"{field}_{'ru' if language == 'kk' else 'kk'}"]
        fallback = fallback or not bool(primary)
    item["translation_fallback"] = fallback
    item["sources"] = [dict(source) for source in db.execute("""SELECT s.* FROM sources s
        JOIN event_sources es ON es.source_id=s.id JOIN historical_events e ON e.id=es.event_id
        WHERE e.slug=? ORDER BY s.id""", (item["slug"],)).fetchall()]
    for field in ("title_kk", "title_ru", "summary_kk", "summary_ru", "body_kk", "body_ru"):
        item.pop(field, None)
    return item
