"""Lightweight ARTEM-inspired spatial-temporal episodic retrieval.

This is deterministic, structured cue matching, not the original STEM network.
Queries are restricted to one observer's memories to prevent information leaks.
"""

from enum import Enum
from memory.memory_event import MemoryEvent
from memory.memory_store import MemoryStore


class TemporalAccess(str, Enum):
    ALL = "all"
    LATEST = "latest"
    CHRONOLOGICAL = "chronological"


class SpatiotemporalRetriever:
    def __init__(self, store: MemoryStore):
        self.store = store

    def retrieve(
        self,
        game_id: str,
        observer_id: str,
        *,
        actor_id: str | None = None,
        target_id: str | None = None,
        person_id: str | None = None,
        location: str | None = None,
        event_type: str | None = None,
        start_time: float | None = None,
        end_time: float | None = None,
        mode: TemporalAccess | str = TemporalAccess.CHRONOLOGICAL,
    ) -> list[MemoryEvent]:
        """Match all supplied cues. person_id matches actor OR target.

        No matching events means no evidence; callers should not invent an answer.
        """
        mode = TemporalAccess(mode)
        if start_time is not None and end_time is not None and start_time > end_time:
            raise ValueError("start_time은 end_time보다 클 수 없습니다.")

        events = self.store.get_memories(game_id, observer_id)
        matched = [
            event for event in events
            if (actor_id is None or event.actor_id == actor_id)
            and (target_id is None or event.target_id == target_id)
            and (person_id is None or person_id in (event.actor_id, event.target_id))
            and (location is None or event.location == location)
            and (event_type is None or event.event_type == event_type)
            and (start_time is None or event.game_time >= start_time)
            and (end_time is None or event.game_time <= end_time)
        ]
        matched.sort(key=lambda event: (event.game_time, event.event_id))
        if mode == TemporalAccess.LATEST:
            return matched[-1:]  # [] when there is no matching memory
        return matched
