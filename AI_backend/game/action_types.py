
from enum import Enum

from pydantic import BaseModel, Field


class ActionType(str, Enum):
    MOVE = "move"
    SPEAK = "speak"
    CALL_MEETING = "call_meeting"
    REPORT_BODY = "report_body"

    # 이후 단계에서 구현할 행동
    MAFIA_KILL = "mafia_kill"
    VOTE = "vote"


class ActionRequest(BaseModel):
    actor_id: str
    action_type: ActionType

    target_id: str | None = None

    payload: dict = Field(
        default_factory=dict
    )


class ActionResult(BaseModel):
    success: bool
    message: str

    event_id: str | None = None
