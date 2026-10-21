"""Retrieval adapters for the guide's grounded answer context."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from .storage import list_events, search_document_chunks


@dataclass(frozen=True)
class RetrievedContext:
    events: list[dict]
    documents: list[dict]


class LocalRetriever(Protocol):
    def retrieve(self, question: str, language: str) -> RetrievedContext: ...


class SQLiteFTSRetriever:
    """Retrieve matching event records and indexed document chunks from SQLite."""

    def retrieve(self, question: str, language: str) -> RetrievedContext:
        terms = [term.casefold() for term in question.split() if len(term) > 2]
        candidates, _ = list_events(language, limit=100)
        scored: list[tuple[int, dict]] = []
        for event in candidates:
            corpus = " ".join(str(event.get(key, "")) for key in ("title", "summary", "body")).casefold()
            score = sum(corpus.count(term) for term in terms)
            if score:
                scored.append((score, event))
        events = [event for _, event in sorted(scored, key=lambda item: item[0], reverse=True)[:3]]
        documents, _ = search_document_chunks(question, language, limit=3)
        return RetrievedContext(events=events, documents=documents)
