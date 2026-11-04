
from uuid import uuid4

from pydantic import BaseModel

from state.global_state import GlobalGameState
from state.enums import GameStatus, GamePhase

from events.event_manager import EventManager
from events.event_types import EventType, EventVisibility

from game.game_manager import GameManager


class Body(BaseModel):
    body_id: str
    victim_id: str
    location: str

    is_reported: bool = False


class BodyManager:
    def __init__(self, game_manager: GameManager):
        self.manager = game_manager
        self.game: GlobalGameState = game_manager.game
        self.events: EventManager = game_manager.events

        self.bodies: dict[str, Body] = {}

    def create_body(self, victim_id: str) -> Body:
        if self.game.status != GameStatus.RUNNING:
            raise ValueError("게임이 진행 중이지 않습니다.")

        if self.game.phase not in (
            GamePhase.DAY,
            GamePhase.NIGHT
        ):
            raise ValueError("현재 시체를 생성할 수 없습니다.")

        victim = self.game.players.get(victim_id)

        if victim is None:
            raise ValueError("존재하지 않는 플레이어입니다.")

        if not victim.is_alive:
            raise ValueError("이미 탈락한 플레이어입니다.")

        # 현재는 테스트를 위한 탈락 처리
        victim.is_alive = False

        body = Body(
            body_id=str(uuid4()),
            victim_id=victim_id,
            location=victim.location
        )

        self.bodies[body.body_id] = body

        self.events.create_event(
            event_type=EventType.BODY_CREATED,
            target_id=victim_id,
            payload={
                "body_id": body.body_id,
                "location": body.location
            },
            visibility=EventVisibility.SYSTEM
        )

        return body

    def discover_body(
        self,
        player_id: str,
        body_id: str
    ) -> Body:
        player = self.game.players.get(player_id)
        body = self.bodies.get(body_id)

        if self.game.status != GameStatus.RUNNING:
            raise ValueError("게임이 진행 중이지 않습니다.")

        if self.game.phase not in (
            GamePhase.DAY,
            GamePhase.NIGHT
        ):
            raise ValueError("현재 시체를 발견할 수 없습니다.")

        if player is None or not player.is_alive:
            raise ValueError("생존한 플레이어만 발견할 수 있습니다.")

        if body is None or body.is_reported:
            raise ValueError("발견할 수 없는 시체입니다.")

        if player.location != body.location:
            raise ValueError("시체와 같은 장소에 있어야 합니다.")

        self.events.create_event(
            event_type=EventType.BODY_DISCOVERED,
            actor_id=player_id,
            target_id=body.victim_id,
            payload={"body_id": body.body_id},
            visibility=EventVisibility.PRIVATE,
            audience=[player_id]
        )

        return body

    def report_body(
        self,
        player_id: str,
        body_id: str
    ) -> Body:
        # 먼저 신고 가능 여부 확인
        body = self.bodies.get(body_id)

        if body is None or body.is_reported:
            raise ValueError("신고할 수 없는 시체입니다.")

        player = self.game.players.get(player_id)

        if player is None or not player.is_alive:
            raise ValueError("생존한 플레이어만 신고할 수 있습니다.")

        if player.location != body.location:
            raise ValueError("시체와 같은 장소에 있어야 합니다.")

        if self.game.phase not in (
            GamePhase.DAY,
            GamePhase.NIGHT
        ):
            raise ValueError("현재 신고할 수 없습니다.")

        # 회의 소집 조건을 먼저 검증
        self.manager.call_meeting(
            caller_id=player_id,
            reason="body_report"
        )

        body.is_reported = True

        self.events.create_event(
            event_type=EventType.BODY_REPORTED,
            actor_id=player_id,
            target_id=body.victim_id,
            payload={
                "body_id": body.body_id,
                "location": body.location
            },
            visibility=EventVisibility.PUBLIC
        )

        return body
    