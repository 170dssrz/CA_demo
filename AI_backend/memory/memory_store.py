"""SQLite storage for per-agent episodic memories.

Uses the MemoryEvent schema in memory_event.py. This is an ARTEM-inspired
structured store, not the original ARTEM/STEM neural network.
"""

import sqlite3
from contextlib import closing
from pathlib import Path

from memory.memory_event import MemoryEvent


class MemoryStore:
    def __init__(self, db_path: str | Path = "memory.db"):
        self.db_path = str(db_path)
        with closing(self._connect()) as conn, conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS memories (
                    game_id TEXT NOT NULL,
                    observer_id TEXT NOT NULL,
                    event_id TEXT NOT NULL,
                    game_time REAL NOT NULL,
                    location TEXT NOT NULL,
                    actor_id TEXT NOT NULL,
                    event_json TEXT NOT NULL,
                    PRIMARY KEY (game_id, observer_id, event_id)
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_memory_time
                ON memories (game_id, observer_id, game_time)
            """)

    def _connect(self):
        return sqlite3.connect(self.db_path, timeout=10)

    def save(self, event: MemoryEvent) -> None:
        """Store one agent's memory; duplicate event IDs are rejected."""
        with closing(self._connect()) as conn, conn:
            conn.execute("""
                INSERT INTO memories
                    (game_id, observer_id, event_id, game_time,
                     location, actor_id, event_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                event.game_id, event.observer_id, event.event_id,
                event.game_time, event.location, event.actor_id,
                event.model_dump_json(),
            ))

    def get_memories(self, game_id: str, observer_id: str) -> list[MemoryEvent]:
        """Return only this observer's memories, oldest first."""
        with closing(self._connect()) as conn, conn:
            rows = conn.execute("""
                SELECT event_json FROM memories
                WHERE game_id = ? AND observer_id = ?
                ORDER BY game_time ASC, event_id ASC
            """, (game_id, observer_id)).fetchall()
        return [MemoryEvent.model_validate_json(row[0]) for row in rows]

    def get_latest(self, game_id: str, observer_id: str) -> MemoryEvent | None:
        """Return the most recent memory or None when no memories exist."""
        with closing(self._connect()) as conn, conn:
            row = conn.execute("""
                SELECT event_json FROM memories
                WHERE game_id = ? AND observer_id = ?
                ORDER BY game_time DESC, event_id DESC
                LIMIT 1
            """, (game_id, observer_id)).fetchone()
        return MemoryEvent.model_validate_json(row[0]) if row else None
