"""Embedding-based RAG retrieval over the same per-agent SQLite memories.

Install: pip install sentence-transformers
The embedding model is loaded lazily on the first retrieve() call.
This module only retrieves memories; it does not generate LLM answers.
"""

from __future__ import annotations

from math import sqrt
from typing import Protocol

from memory.memory_event import MemoryEvent
from memory.memory_store import MemoryStore


class TextEncoder(Protocol):
    def encode(self, sentences: list[str], **kwargs): ...


class RAGRetriever:
    def __init__(
        self,
        store: MemoryStore,
        model_name: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        encoder: TextEncoder | None = None,
    ):
        self.store = store
        self.model_name = model_name
        self._encoder = encoder

    def _get_encoder(self) -> TextEncoder:
        if self._encoder is None:
            try:
                from sentence_transformers import SentenceTransformer
            except ImportError as exc:
                raise ImportError(
                    "RAG 검색에는 sentence-transformers가 필요합니다. "
                    "pip install sentence-transformers 를 실행하세요."
                ) from exc
            self._encoder = SentenceTransformer(self.model_name)
        return self._encoder

    @staticmethod
    def _event_text(event: MemoryEvent) -> str:
        # Identical, publicly representable event fields; no hidden game state.
        target = f" 대상 {event.target_id}" if event.target_id else ""
        return (
            f"시간 {event.game_time}초 장소 {event.location} "
            f"인물 {event.actor_id}{target} "
            f"사건 {event.event_type} 내용 {event.content} "
            f"정보출처 {event.source.value}"
        )

    @staticmethod
    def _cosine(a, b) -> float:
        av, bv = list(a), list(b)
        if len(av) != len(b):
            raise ValueError("임베딩 벡터의 차원이 일치하지 않습니다.")
        denominator = sqrt(sum(x * x for x in av)) * sqrt(sum(y * y for y in bv))
        return sum(x * y for x, y in zip(av, bv)) / denominator if denominator else 0.0

    def retrieve(
        self,
        game_id: str,
        observer_id: str,
        query: str,
        top_k: int = 3,
        min_similarity: float | None = None,
    ) -> list[MemoryEvent]:
        """Return the top-k semantically similar memories owned by observer_id.

        The threshold is optional: evaluate it on a validation set rather than
        tuning it on final test questions. Without a threshold, irrelevant
        memories can be returned even when the correct answer is unknown.
        """
        if not query.strip():
            raise ValueError("query는 비어 있을 수 없습니다.")
        if top_k < 1:
            raise ValueError("top_k는 1 이상이어야 합니다.")
        if min_similarity is not None and not -1.0 <= min_similarity <= 1.0:
            raise ValueError("min_similarity는 -1부터 1 사이여야 합니다.")

        memories = self.store.get_memories(game_id, observer_id)
        if not memories:
            return []

        texts = [query] + [self._event_text(event) for event in memories]
        vectors = self._get_encoder().encode(texts)
        if len(vectors) != len(texts):
            raise ValueError("임베딩 결과 수가 입력 문장 수와 다릅니다.")

        scored = [
            (self._cosine(vectors[0], vectors[i + 1]), i, event)
            for i, event in enumerate(memories)
        ]
        scored.sort(key=lambda item: (-item[0], item[1]))
        return [
            event for score, _, event in scored
            if min_similarity is None or score >= min_similarity
        ][:top_k]
