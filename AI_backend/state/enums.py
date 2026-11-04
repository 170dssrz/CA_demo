
from enum import Enum

class GameStatus(str, Enum):
    WAITING = "waiting"
    RUNNING = "running"
    FINISHED = "finished"


class GamePhase(str, Enum):
    DAY = "day"
    NIGHT = "night"
    MEETING = "meeting"
    VOTING = "voting"



class PlayerType(str, Enum):
    HUMAN = "human"
    AI = "ai"


class PlayerRole(str, Enum):
    CITIZEN = "citizen"
    MAFIA = "mafia"
    DOCTOR = "doctor"
    DETECTIVE = "detective"


class Team(str, Enum):
    CITIZEN = "citizen"
    MAFIA = "mafia"
