from game.voting_manager import VotingManager

from game.mafia_action_manager import MafiaActionManager

from game.location_manager import LocationManager
from game.body_manager import BodyManager

from state.enums import GameStatus, GamePhase
from game.action_types import (
    ActionType,
    ActionRequest,
    ActionResult
)
from game.game_manager import GameManager

from events.event_types import EventType


class ActionManager:
    def __init__(self, game_manager: GameManager):
        self.manager = game_manager
        self.game = game_manager.game
        self.locations = LocationManager(
            self.game,
            self.manager.events
        )

        self.bodies = BodyManager(self.manager)

        self.mafia = MafiaActionManager(
            self.manager,
            self.bodies
        )

        self.voting = VotingManager(self.manager)



    def execute(self, request: ActionRequest) -> ActionResult:
        # 게임 진행 상태 검사
        if self.game.status != GameStatus.RUNNING:
            return ActionResult(
                success=False,
                message="게임이 진행 중이지 않습니다."
            )

        # 행동하는 플레이어 검사
        actor = self.game.players.get(request.actor_id)

        if actor is None:
            return ActionResult(
                success=False,
                message="존재하지 않는 플레이어입니다."
            )

        if not actor.is_alive:
            return ActionResult(
                success=False,
                message="탈락한 플레이어는 행동할 수 없습니다."
            )

        action = request.action_type

        if action == ActionType.MOVE:
            return self._move(request)

        if action == ActionType.SPEAK:
            return self._speak(request)

        if action == ActionType.CALL_MEETING:
            return self._call_meeting(request)

        if action == ActionType.REPORT_BODY:
            return self._report_body(request)

        if action == ActionType.MAFIA_KILL:
            return self._mafia_kill(request)

        if action == ActionType.VOTE:
            return self._vote(request)

        return ActionResult(
            success=False,
            message="아직 구현되지 않은 행동입니다."
        )


    def _move(self, request: ActionRequest) -> ActionResult:
        destination = request.payload.get("location")

        if not isinstance(destination, str):
            return ActionResult(
                success=False,
                message="이동 장소가 올바르지 않습니다."
            )

        try:
            event = self.locations.move(
                player_id=request.actor_id,
                destination=destination
            )
        except ValueError as error:
            return ActionResult(
                success=False,
                message=str(error)
            )

        return ActionResult(
            success=True,
            message="이동했습니다.",
            event_id=event.event_id
        )


    def _speak(self, request: ActionRequest) -> ActionResult:
        if self.game.phase not in (
            GamePhase.DAY,
            GamePhase.NIGHT,
            GamePhase.MEETING
        ):
            return ActionResult(
                success=False,
                message="현재 단계에서는 발언할 수 없습니다."
            )

        text = request.payload.get("text")

        if not isinstance(text, str) or not text.strip():
            return ActionResult(
                success=False,
                message="발언 내용을 입력해야 합니다."
            )

        if request.target_id is not None:
            target = self.game.players.get(request.target_id)

            if target is None:
                return ActionResult(
                    success=False,
                    message="대화 상대가 존재하지 않습니다."
                )

            if not target.is_alive:
                return ActionResult(
                    success=False,
                    message="탈락한 플레이어에게 말할 수 없습니다."
                )

        event = self.manager.events.create_event(
            event_type=EventType.PLAYER_SPOKE,
            actor_id=request.actor_id,
            target_id=request.target_id,
            payload={"text": text}
        )

        return ActionResult(
            success=True,
            message="발언이 기록되었습니다.",
            event_id=event.event_id
        )

    def _call_meeting(self, request: ActionRequest) -> ActionResult:
        try:
            self.manager.call_meeting(
                caller_id=request.actor_id,
                reason="emergency"
            )
        except ValueError as error:
            return ActionResult(
                success=False,
                message=str(error)
            )

        event = self.manager.events.events[-1]

        return ActionResult(
            success=True,
            message="긴급 회의가 시작되었습니다.",
            event_id=event.event_id
        )

    
    def _report_body(self, request: ActionRequest) -> ActionResult:
        body_id = request.payload.get("body_id")

        if not isinstance(body_id, str):
            return ActionResult(
                success=False,
                message="시체 ID가 필요합니다."
            )

        try:
            self.bodies.report_body(
                player_id=request.actor_id,
                body_id=body_id
            )
        except ValueError as error:
            return ActionResult(
                success=False,
                message=str(error)
            )

        event = self.manager.events.events[-1]

        return ActionResult(
            success=True,
            message="시체 신고로 회의가 시작되었습니다.",
            event_id=event.event_id
        )

    
    def _mafia_kill(
        self,
        request: ActionRequest
    ) -> ActionResult:

        if request.target_id is None:
            return ActionResult(
                success=False,
                message="대상 플레이어를 지정해야 합니다."
            )

        try:
            event, body = self.mafia.perform_action(
                actor_id=request.actor_id,
                target_id=request.target_id
            )

        except ValueError as error:
            return ActionResult(
                success=False,
                message=str(error)
            )

        return ActionResult(
            success=True,
            message="마피아 행동이 처리되었습니다.",
            event_id=event.event_id
        )

    
    def _vote(
        self,
        request: ActionRequest
    ) -> ActionResult:

        if request.target_id is None:
            return ActionResult(
                success=False,
                message="투표 대상 또는 skip을 지정해야 합니다."
            )

        try:
            event = self.voting.cast_vote(
                voter_id=request.actor_id,
                target_id=request.target_id
            )

        except ValueError as error:
            return ActionResult(
                success=False,
                message=str(error)
            )

        return ActionResult(
            success=True,
            message="투표가 제출되었습니다.",
            event_id=event.event_id
        )



