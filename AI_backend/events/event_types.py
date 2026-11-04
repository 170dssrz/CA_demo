
from enum import Enum


class EventType(str, Enum):
    GAME_STARTED = "game_started"
    PHASE_CHANGED = "phase_changed"
    PLAYER_SPOKE = "player_spoke"
    VOTE_CAST = "vote_cast"
    PLAYER_ELIMINATED = "player_eliminated"
    NIGHT_ACTION = "night_action"
    GAME_ENDED = "game_ended"
    PLAYER_MOVED = "player_moved"
    BODY_CREATED = "body_created"
    BODY_DISCOVERED = "body_discovered"
    BODY_REPORTED = "body_reported"
    MAFIA_ACTION = "mafia_action"
    VOTE_SUBMITTED = "vote_submitted"
    VOTING_RESULT = "voting_result" 


class EventVisibility(str, Enum):
    PUBLIC = "public"
    PRIVATE = "private"
    TEAM = "team"
    SYSTEM = "system"
