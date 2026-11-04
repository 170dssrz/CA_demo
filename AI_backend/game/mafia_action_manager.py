
from state.enums import GameStatus, GamePhase, Team

from events.event_types import (
    EventType,
    EventVisibility
)

from game.game_manager import GameManager
from game.body_manager import BodyManager


class MafiaActionManager:
    def __init__(
        self,
        game_manager: GameManager,
        body_manager: BodyManager
    ):
        self.manager = game_manager
        self.game = game_manager.game
        self.bodies = body_manager

        # 플레이어별 마지막 행동 날짜
        self.last_action_day: dict[str, int] = {}

    def perform_action(
        self,
        actor_id: str,
        target_id: str
    ):
        # 1. 게임 상태 확인
        if self.game.status != GameStatus.RUNNING:
            raise ValueError("게임이 진행 중이지 않습니다.")

        # 2. 밤 단계 확인
        if self.game.phase != GamePhase.NIGHT:
            raise ValueError("마피아 행동은 밤에만 가능합니다.")

        # 3. 행동자 확인
        actor = self.game.players.get(actor_id)

        if actor is None or not actor.is_alive:
            raise ValueError("행동할 수 없는 플레이어입니다.")

        if actor.team != Team.MAFIA:
            raise ValueError("마피아만 사용할 수 있는 행동입니다.")

        # 4. 대상 확인
        target = self.game.players.get(target_id)

        if target is None or not target.is_alive:
            raise ValueError("유효하지 않은 대상입니다.")

        if target.team == Team.MAFIA:
            raise ValueError("같은 마피아 팀은 대상으로 선택할 수 없습니다.")

        if actor_id == target_id:
            raise ValueError("자기 자신은 대상으로 선택할 수 없습니다.")

        # 5. 위치 확인
        if actor.location != target.location:
            raise ValueError("같은 장소에 있는 대상만 선택할 수 있습니다.")

        # 6. 밤마다 1회 제한
        if self.last_action_day.get(actor_id) == self.game.day:
            raise ValueError("이번 밤에는 이미 행동했습니다.")

        # 7. 대상 탈락 및 시체 생성
        body = self.bodies.create_body(target_id)

        # 8. 행동 횟수 기록
        self.last_action_day[actor_id] = self.game.day

        # 9. 비밀 이벤트 기록
        event = self.manager.events.create_event(
            event_type=EventType.MAFIA_ACTION,
            actor_id=actor_id,
            target_id=target_id,
            payload={
                "body_id": body.body_id,
                "location": body.location
            },
            visibility=EventVisibility.PRIVATE,
            audience=[actor_id]
        )

        self.manager.victory.evaluate()

        return event, body
