
from game.victory_manager import VictoryManager

from game.role_manager import RoleManager

from state.global_state import GlobalGameState
from state.enums import GameStatus, GamePhase

from events.event_manager import EventManager
from events.event_types import EventType

from game.game_config import GameConfig


class GameManager:
    def __init__(
        self,
        game: GlobalGameState,
        config: GameConfig | None = None
    ):
        self.game = game
        self.config = config or GameConfig()
        self.events = EventManager(game.game_id)
        self.victory = VictoryManager(
            self.game,
            self.events
        )
        self.roles = RoleManager(self.game)

    
    def start_game(self, mafia_count: int = 1):
        if self.game.status != GameStatus.WAITING:
            raise ValueError("이미 시작된 게임입니다.")

        count = len(self.game.players)

        if not (
            self.config.min_players
            <= count
            <= self.config.max_players
        ):
            raise ValueError("플레이어 수가 올바르지 않습니다.")

        # 게임 시작 전 직업 배정
        self.roles.assign_roles(mafia_count)

        self.game.status = GameStatus.RUNNING
        self.game.phase = GamePhase.DAY
        self.game.day = 1

        self.events.create_event(
            event_type=EventType.GAME_STARTED,
            payload={
                "day": self.game.day,
                "player_count": count
            }
        )


    def change_phase(self, phase: GamePhase):
        if self.game.status != GameStatus.RUNNING:
            raise ValueError("진행 중인 게임이 아닙니다.")

        if self.game.phase in (
            GamePhase.MEETING,
            GamePhase.VOTING
        ):
            raise ValueError("회의 중에는 단계를 변경할 수 없습니다.")

        if phase not in (GamePhase.DAY, GamePhase.NIGHT):
            raise ValueError("DAY 또는 NIGHT만 지정할 수 있습니다.")

        if phase == self.game.phase:
            raise ValueError("이미 해당 단계입니다.")

        if self.game.phase == GamePhase.NIGHT and phase == GamePhase.DAY:
            self.game.day += 1

        self.game.phase = phase

        self.events.create_event(
            event_type=EventType.PHASE_CHANGED,
            payload={
                "phase": phase.value,
                "day": self.game.day
            }
        )

    def call_meeting(
        self,
        caller_id: str,
        reason: str = "emergency"
    ):
        if self.game.status != GameStatus.RUNNING:
            raise ValueError("게임이 진행 중이지 않습니다.")

        if self.game.phase not in (
            GamePhase.DAY,
            GamePhase.NIGHT
        ):
            raise ValueError("현재 회의를 열 수 없습니다.")

        player = self.game.players.get(caller_id)

        if player is None or not player.is_alive:
            raise ValueError("생존한 플레이어만 회의를 열 수 있습니다.")

        if self.game.phase == GamePhase.NIGHT:
            if not self.config.allow_night_meeting:
                raise ValueError("밤에는 회의를 열 수 없습니다.")

        if reason not in ("emergency", "body_report"):
            raise ValueError("올바르지 않은 회의 사유입니다.")

        if reason == "emergency":
            used = self.game.emergency_meeting_counts.get(
                caller_id, 0
            )

            if used >= self.config.emergency_meetings_per_player:
                raise ValueError("긴급 회의 횟수를 모두 사용했습니다.")

            self.game.emergency_meeting_counts[caller_id] = used + 1

        # 기존 진행 단계 저장
        self.game.previous_phase = self.game.phase

        self.game.phase = GamePhase.MEETING
        self.game.meeting_caller_id = caller_id
        self.game.meeting_reason = reason
        self.game.votes.clear()

        self.events.create_event(
            event_type=EventType.PHASE_CHANGED,
            actor_id=caller_id,
            payload={
                "phase": "meeting",
                "reason": reason
            }
        )

    def start_voting(self):
        if self.game.phase != GamePhase.MEETING:
            raise ValueError("회의 단계가 아닙니다.")

        self.game.phase = GamePhase.VOTING

        self.events.create_event(
            event_type=EventType.PHASE_CHANGED,
            payload={"phase": "voting"}
        )

    def finish_meeting(self):
        if self.game.phase != GamePhase.VOTING:
            raise ValueError("투표 단계가 아닙니다.")

        if self.game.status == GameStatus.FINISHED:
            raise ValueError("종료된 게임에서는 회의를 마칠 수 없습니다.")

        if self.game.previous_phase is None:
            raise ValueError("복귀할 단계가 없습니다.")

        self.game.phase = self.game.previous_phase
        self.game.previous_phase = None

        self.game.meeting_caller_id = None
        self.game.meeting_reason = None
        self.game.votes.clear()

        self.events.create_event(
            event_type=EventType.PHASE_CHANGED,
            payload={"phase": self.game.phase.value}
        )
