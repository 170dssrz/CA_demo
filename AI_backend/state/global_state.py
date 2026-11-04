
from pydantic import BaseModel, Field

from .enums import GameStatus, GamePhase, Team
from .player_state import PlayerState


class GlobalGameState(BaseModel):
    game_id: str

    status: GameStatus = GameStatus.WAITING
    phase: GamePhase = GamePhase.DAY

    day: int = 1
    turn: int = 0

    players: dict[str, PlayerState] = Field(
        default_factory=dict
    )

    votes: dict[str, str] = Field(
        default_factory=dict
    )

    # 회의 직전의 진행 단계
    previous_phase: GamePhase | None = None

    # 회의를 소집한 플레이어
    meeting_caller_id: str | None = None

    # 회의 소집 이유
    meeting_reason: str | None = None

    # 플레이어별 긴급 회의 사용 횟수
    emergency_meeting_counts: dict[str, int] = Field(
        default_factory=dict
    )

    version: int = 1

    winner: Team | None = None
