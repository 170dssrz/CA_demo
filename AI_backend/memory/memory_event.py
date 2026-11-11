"""ARTEM-inspired event schema for an AI Mafia game's episodic memory.

This is a structured event representation, not the original ARTEM/STEM network.
"""

from enum import Enum
from pydantic import BaseModel, Field, model_validator


class MemorySource(str, Enum):
    SELF = "self"
    OBSERVATION = "observation"
    TESTIMONY = "testimony"


class MemoryEvent(BaseModel):
    event_id: str = Field(min_length=1)
    game_id: str = Field(min_length=1)
    game_time: float = Field(ge=0, description="Seconds elapsed since game start")
    location: str = Field(min_length=1)
    actor_id: str = Field(min_length=1)
    event_type: str = Field(min_length=1)
    content: str = Field(min_length=1)
    target_id: str | None = None

    # Perspective-specific memory fields: who remembers it, and how they learned it.
    observer_id: str = Field(min_length=1)
    source: MemorySource
    informant_id: str | None = None

    @model_validator(mode="after")
    def validate_source(self):
        if self.source == MemorySource.SELF and self.observer_id != self.actor_id:
            raise ValueError("self 기억은 observer_id와 actor_id가 같아야 합니다.")
        if self.source == MemorySource.TESTIMONY and not self.informant_id:
            raise ValueError("testimony 기억에는 informant_id가 필요합니다.")
        if self.source != MemorySource.TESTIMONY and self.informant_id is not None:
            raise ValueError("informant_id는 testimony 기억에만 사용합니다.")
        return self
