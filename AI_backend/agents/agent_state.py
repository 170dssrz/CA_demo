
from pydantic import BaseModel, Field

from agents.personality import Personality


class EmotionState(BaseModel):
    anxiety: float = Field(default=0.0, ge=0, le=1)
    anger: float = Field(default=0.0, ge=0, le=1)
    confidence: float = Field(default=0.5, ge=0, le=1)


class RelationshipState(BaseModel):
    trust: float = Field(default=0.5, ge=0, le=1)
    suspicion: float = Field(default=0.0, ge=0, le=1)


class AgentState(BaseModel):
    agent_id: str
    player_id: str

    personality: Personality

    emotions: EmotionState = Field(
        default_factory=EmotionState
    )

    relationships: dict[str, RelationshipState] = Field(
        default_factory=dict
    )

    memory_ids: list[str] = Field(
        default_factory=list
    )

    goals: list[str] = Field(
        default_factory=list
    )
