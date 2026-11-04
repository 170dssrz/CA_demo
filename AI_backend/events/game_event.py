
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field

from .event_types import EventType, EventVisibility


class GameEvent(BaseModel):
    event_id: str = Field(
        default_factory=lambda: str(uuid4())
    )

    game_id: str
    sequence: int = Field(ge=1)
    event_type: EventType

    actor_id: str | None = None
    target_id: str | None = None

    payload: dict[str, Any] = Field(
        default_factory=dict
    )

    visibility: EventVisibility = EventVisibility.PUBLIC

    audience: list[str] = Field(
        default_factory=list
    )

    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
