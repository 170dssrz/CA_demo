
from state.global_state import GlobalGameState
from state.enums import GameStatus, GamePhase

from events.event_manager import EventManager
from events.event_types import EventType, EventVisibility


class LocationManager:
    def __init__(
        self,
        game: GlobalGameState,
        events: EventManager
    ):
        self.game = game
        self.events = events

        # 현재는 간단한 장소 연결 그래프 사용
        self.map = {
            "hall": ["cafeteria", "storage"],
            "cafeteria": ["hall", "kitchen"],
            "kitchen": ["cafeteria"],
            "storage": ["hall"]
        }

    def move(self, player_id: str, destination: str):
        if self.game.status != GameStatus.RUNNING:
            raise ValueError("게임이 진행 중이지 않습니다.")

        if self.game.phase not in (
            GamePhase.DAY,
            GamePhase.NIGHT
        ):
            raise ValueError("현재는 이동할 수 없습니다.")

        player = self.game.players.get(player_id)

        if player is None or not player.is_alive:
            raise ValueError("이동 가능한 플레이어가 아닙니다.")

        if destination not in self.map:
            raise ValueError("존재하지 않는 장소입니다.")

        current = player.location

        if destination not in self.map.get(current, []):
            raise ValueError(
                f"{current}에서 {destination}(으)로 이동할 수 없습니다."
            )

        player.location = destination

        event = self.events.create_event(
            event_type=EventType.PLAYER_MOVED,
            actor_id=player_id,
            payload={
                "from": current,
                "to": destination
            },
            visibility=EventVisibility.SYSTEM
        )

        return event

    def get_players_at(self, location: str):
        return [
            player.player_id
            for player in self.game.players.values()
            if player.is_alive and player.location == location
        ]
