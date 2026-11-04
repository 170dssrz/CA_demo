
from state.global_state import GlobalGameState
from state.enums import GameStatus, Team

from events.event_manager import EventManager
from events.event_types import EventType, EventVisibility


class VictoryManager:
    def __init__(
        self,
        game: GlobalGameState,
        events: EventManager
    ):
        self.game = game
        self.events = events

    def check_winner(self) -> Team | None:
        """현재 생존 인원으로 승리 팀을 판정한다."""

        if self.game.status != GameStatus.RUNNING:
            return None

        mafia_count = 0
        citizen_count = 0

        for player in self.game.players.values():
            if not player.is_alive:
                continue

            if player.team == Team.MAFIA:
                mafia_count += 1

            elif player.team == Team.CITIZEN:
                citizen_count += 1

        if mafia_count == 0:
            return Team.CITIZEN

        if mafia_count >= citizen_count:
            return Team.MAFIA

        return None

    def evaluate(self) -> Team | None:
        """승리 조건을 확인하고 게임을 종료한다."""

        winner = self.check_winner()

        if winner is None:
            return None

        self.game.winner = winner
        self.game.status = GameStatus.FINISHED

        self.events.create_event(
            event_type=EventType.GAME_ENDED,
            payload={
                "winner": winner.value,
                "day": self.game.day
            },
            visibility=EventVisibility.PUBLIC
        )

        return winner
