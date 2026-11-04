
from pydantic import BaseModel, Field


class GameConfig(BaseModel):
    max_players: int = Field(default=10, ge=3)
    min_players: int = Field(default=4, ge=3)

    day_duration: int = Field(default=300, gt=0)
    night_duration: int = Field(default=180, gt=0)

    meeting_duration: int = Field(default=120, gt=0)
    voting_duration: int = Field(default=60, gt=0)

    emergency_meetings_per_player: int = Field(
        default=1,
        ge=0
    )

    allow_night_meeting: bool = True
    reveal_role_on_elimination: bool = False
