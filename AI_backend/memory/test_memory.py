"""Run from AI_backend: python -m memory.test_memory"""
from tempfile import TemporaryDirectory
from pathlib import Path

from memory.memory_event import MemoryEvent, MemorySource
from memory.memory_store import MemoryStore
from memory.spatiotemporal_retriever import SpatiotemporalRetriever, TemporalAccess


def run_test():
    with TemporaryDirectory() as directory:
        store = MemoryStore(Path(directory) / "test_memory.db")

        retriever = SpatiotemporalRetriever(store)
        common = {"game_id": "test_game", "observer_id": "ai_001", "source": MemorySource.OBSERVATION}
        events = [
            MemoryEvent(**common, event_id="e1", game_time=10, location="cafeteria", actor_id="ai_002", event_type="PLAYER_SEEN", content="AI 2 was seen in the cafeteria"),
            MemoryEvent(**common, event_id="e2", game_time=25, location="storage", actor_id="ai_003", event_type="PLAYER_SEEN", content="AI 3 was seen in storage"),
            MemoryEvent(**common, event_id="e3", game_time=40, location="hallway", actor_id="ai_002", event_type="PLAYER_SEEN", content="AI 2 was seen in the hallway"),
            MemoryEvent(game_id="test_game", observer_id="ai_002", source=MemorySource.OBSERVATION, event_id="secret", game_time=50, location="storage", actor_id="ai_004", event_type="PLAYER_SEEN", content="Private memory of AI 2"),
        ]
        for event in events:
            store.save(event)

        memories = retriever.retrieve("test_game", "ai_001")
        assert [e.event_id for e in memories] == ["e1", "e2", "e3"]
        print("PASS: AI 1 chronological memory", [e.event_id for e in memories])

        by_person = retriever.retrieve("test_game", "ai_001", person_id="ai_002")
        assert [e.event_id for e in by_person] == ["e1", "e3"]
        print("PASS: person cue", [e.event_id for e in by_person])

        latest = retriever.retrieve("test_game", "ai_001", mode=TemporalAccess.LATEST)
        assert len(latest) == 1 and latest[0].event_id == "e3"
        print("PASS: latest memory", latest[0].event_id)

        by_location = retriever.retrieve("test_game", "ai_001", location="storage")
        assert [e.event_id for e in by_location] == ["e2"]
        print("PASS: location cue", [e.event_id for e in by_location])

        missing = retriever.retrieve("test_game", "ai_001", person_id="ai_999")
        assert missing == []
        print("PASS: unknown memory returns empty list")

        assert "secret" not in [e.event_id for e in memories]
        assert [e.event_id for e in retriever.retrieve("test_game", "ai_002")] == ["secret"]
        print("PASS: memories isolated by observer")

    print("ALL 6 TESTS PASSED")


if __name__ == "__main__":
    run_test()
