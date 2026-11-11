"""Compare RAG and ARTEM-inspired structured retrieval on labeled game memories.

Run from AI_backend: python -m evaluation.compare_retrievers
Install: python -m pip install sentence-transformers
This evaluates retrieval only, NOT Claude answers or the original ARTEM/STEM.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from tempfile import TemporaryDirectory

from memory.memory_event import MemoryEvent, MemorySource
from memory.memory_store import MemoryStore
from memory.rag_retriever import RAGRetriever
from memory.spatiotemporal_retriever import SpatiotemporalRetriever, TemporalAccess

GAME = "comparison_game"
OBSERVER = "ai_001"


@dataclass(frozen=True)
class Question:
    name: str
    query: str
    expected: tuple[str, ...]
    cues: dict = field(default_factory=dict)
    mode: TemporalAccess = TemporalAccess.CHRONOLOGICAL
    # A latest question expects one event; other questions use top-k equal to
    # the number of gold events. This keeps retrieved list sizes comparable.


def seed(store: MemoryStore) -> None:
    rows = [
        ("e1", 10, "cafeteria", "ai_002", "AI 2를 식당에서 목격했다."),
        ("e2", 25, "storage", "ai_003", "AI 3을 창고에서 목격했다."),
        ("e3", 40, "hallway", "ai_002", "AI 2를 복도에서 목격했다."),
        ("e4", 55, "storage", "ai_004", "AI 4를 창고에서 목격했다."),
        ("e5", 70, "cafeteria", "ai_003", "AI 3을 식당에서 목격했다."),
    ]
    for event_id, time, location, actor, content in rows:
        store.save(MemoryEvent(
            event_id=event_id, game_id=GAME, game_time=time,
            location=location, actor_id=actor, event_type="PLAYER_SEEN",
            content=content, observer_id=OBSERVER,
            source=MemorySource.OBSERVATION,
        ))
    # This memory must never be retrieved for AI 1.
    store.save(MemoryEvent(
        event_id="secret", game_id=GAME, game_time=90,
        location="storage", actor_id="ai_005", event_type="PLAYER_SEEN",
        content="AI 5를 창고에서 목격했다.", observer_id="ai_002",
        source=MemorySource.OBSERVATION,
    ))


QUESTIONS = [
    Question("person", "AI 2를 목격한 사건은?", ("e1", "e3"), {"person_id": "ai_002"}),
    Question("location", "창고에서 목격한 사건은?", ("e2", "e4"), {"location": "storage"}),
    Question("latest-person", "AI 2를 가장 최근에 목격한 사건은?", ("e3",),
             {"person_id": "ai_002"}, TemporalAccess.LATEST),
    Question("latest-overall", "가장 최근에 목격한 사건은?", ("e5",),
             {}, TemporalAccess.LATEST),
    Question("chronological-person", "AI 2를 목격한 사건을 시간순으로 나열해 줘.",
             ("e1", "e3"), {"person_id": "ai_002"}),
    Question("person-3", "AI 3을 목격한 사건은?", ("e2", "e5"), {"person_id": "ai_003"}),
]


def score(retrieved: list[str], expected: tuple[str, ...]) -> tuple[float, bool]:
    """Set recall and exact ordered-match. Recall ignores order; exact does not."""
    recall = len(set(retrieved) & set(expected)) / len(expected)
    return recall, tuple(retrieved) == expected


def run() -> None:
    with TemporaryDirectory() as directory:
        store = MemoryStore(Path(directory) / "comparison.db")
        seed(store)
        rag = RAGRetriever(store)
        structured = SpatiotemporalRetriever(store)
        totals = {"RAG": [0.0, 0], "Structured": [0.0, 0]}

        print("Retrieval comparison (not LLM answer accuracy)")
        print("Same SQLite events and observer; real embedding model for RAG.")
        print("NOTE: Structured search is given manually labeled cues; RAG gets raw Korean text.")
        print("NOTE: RAG ranking is by similarity, not guaranteed chronological order.\n")

        for q in QUESTIONS:
            k = len(q.expected)
            rag_events = rag.retrieve(GAME, OBSERVER, q.query, top_k=k)
            struct_events = structured.retrieve(GAME, OBSERVER, mode=q.mode, **q.cues)
            # Cap both to k; structured chronological order is preserved.
            struct_events = struct_events[:k]
            results = {
                "RAG": [e.event_id for e in rag_events],
                "Structured": [e.event_id for e in struct_events],
            }
            print(f"[{q.name}] {q.query}\n  expected: {list(q.expected)}")
            for method, ids in results.items():
                assert "secret" not in ids, "Observer memory isolation failed!"
                recall, exact = score(ids, q.expected)
                totals[method][0] += recall
                totals[method][1] += int(exact)
                print(f"  {method:10s}: {ids} | recall={recall:.2f}, ordered_exact={exact}")
            print()

        n = len(QUESTIONS)
        print(f"SUMMARY ({n} labeled questions)")
        for method, (recall_sum, exact_sum) in totals.items():
            print(f"  {method:10s}: mean_recall={recall_sum/n:.3f}, "
                  f"ordered_exact_accuracy={exact_sum/n:.3f} ({exact_sum}/{n})")
        print("IMPORTANT: Small illustrative dataset; not evidence of general superiority.")
        print("Unknown-memory abstention and end-to-end Claude QA are NOT evaluated here.")


if __name__ == "__main__":
    run()
