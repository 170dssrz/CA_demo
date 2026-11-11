"""Run from AI_backend: python -m memory.test_rag

Integration test of the real multilingual embedding model, SQLite storage,
and per-agent memory isolation. First run downloads the model.
"""
from pathlib import Path
from tempfile import TemporaryDirectory

from memory.memory_event import MemoryEvent, MemorySource
from memory.memory_store import MemoryStore
from memory.rag_retriever import RAGRetriever


def run_test() -> None:
    with TemporaryDirectory() as directory:
        store = MemoryStore(Path(directory) / "rag_test.db")
        shared = dict(game_id="test_game", observer_id="ai_001", source=MemorySource.OBSERVATION)
        events = [
            MemoryEvent(**shared, event_id="e1", game_time=10, location="cafeteria", actor_id="ai_002", event_type="PLAYER_SEEN", content="AI 2를 식당에서 목격했다."),
            MemoryEvent(**shared, event_id="e2", game_time=25, location="storage", actor_id="ai_003", event_type="PLAYER_SEEN", content="AI 3을 창고에서 목격했다."),
            MemoryEvent(**shared, event_id="e3", game_time=40, location="hallway", actor_id="ai_002", event_type="PLAYER_SEEN", content="AI 2를 복도에서 목격했다."),
            MemoryEvent(game_id="test_game", observer_id="ai_002", source=MemorySource.OBSERVATION, event_id="secret", game_time=50, location="storage", actor_id="ai_004", event_type="PLAYER_SEEN", content="AI 4가 비밀 통로에 들어갔다."),
        ]
        for event in events:
            store.save(event)
        print("PASS: four sample memories saved")

        rag = RAGRetriever(store)
        question = "AI 2를 어디에서 봤어?"
        print("Loading multilingual embedding model (first run may take time)...")
        found = rag.retrieve("test_game", "ai_001", question, top_k=3)
        assert len(found) == 3, f"Expected 3 memories, got {len(found)}"
        print("PASS: real embedding search returned three memories")
        print(f"Question: {question}")
        for rank, event in enumerate(found, start=1):
            print(f"  {rank}. {event.event_id}: {event.content} (time={event.game_time})")

        assert "secret" not in [event.event_id for event in found]
        print("PASS: other agent's private memory is excluded")

        own = rag.retrieve("test_game", "ai_002", "비밀 통로에 누가 들어갔어?", top_k=3)
        assert [event.event_id for event in own] == ["secret"]
        print("PASS: AI 2 retrieves only its own memory")

        empty = rag.retrieve("test_game", "ai_999", "무슨 일이 있었어?")
        assert empty == []
        print("PASS: unknown agent has no memories")

        assert all(event.observer_id == "ai_001" for event in found)
        print("PASS: observer IDs are consistent")

    print("ALL 6 RAG TESTS PASSED")
    print("NOTE: Ranking quality is not asserted; inspect results and evaluate with labeled questions later.")


if __name__ == "__main__":
    run_test()
