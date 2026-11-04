
from pydantic import BaseModel, Field
from .enums import PlayerType, PlayerRole, Team


class PlayerState(BaseModel):
    player_id: str
    name: str

    player_type: PlayerType

    role: PlayerRole
    team: Team

    is_alive: bool = True

    current_vote: str | None = None

    status_effects: list[str] = Field(
        default_factory=list
    
    )

    location: str = "hall"
