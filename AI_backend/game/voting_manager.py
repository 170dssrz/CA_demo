
from collections import Counter

from pydantic import BaseModel, Field

from state.enums import GamePhase, GameStatus

from events.event_types import (
    EventType,
    EventVisibility
)

from game.game_manager import GameManager


class VotingResult(BaseModel):
    eliminated_id: str | None = None
    is_tie: bool = False

    vote_counts: dict[str, int] = Field(
        default_factory=dict
    )

    skip_count: int = 0


class VotingManager:
    SKIP = "skip"

    def __init__(self, game_manager: GameManager):
        self.manager = game_manager
        self.game = game_manager.game
        self.events = game_manager.events

    def cast_vote(
        self,
        voter_id: str,
        target_id: str
    ):
        if self.game.status != GameStatus.RUNNING:
            raise ValueError("게임이 진행 중이지 않습니다.")

        if self.game.phase != GamePhase.VOTING:
            raise ValueError("현재 투표 단계가 아닙니다.")

        voter = self.game.players.get(voter_id)

        if voter is None or not voter.is_alive:
            raise ValueError("투표할 수 없는 플레이어입니다.")

        if voter_id in self.game.votes:
            raise ValueError("이미 투표했습니다.")

        if target_id != self.SKIP:
            target = self.game.players.get(target_id)

            if target is None or not target.is_alive:
                raise ValueError("유효하지 않은 투표 대상입니다.")

            if voter_id == target_id:
                raise ValueError("자기 자신에게 투표할 수 없습니다.")

        self.game.votes[voter_id] = target_id

        event = self.events.create_event(
            event_type=EventType.VOTE_SUBMITTED,
            actor_id=voter_id,
            payload={"submitted": True},
            visibility=EventVisibility.SYSTEM
        )

        return event

    def all_votes_submitted(self) -> bool:
        if self.game.phase != GamePhase.VOTING:
            return False

        alive_ids = {
            player.player_id
            for player in self.game.players.values()
            if player.is_alive
        }

        return alive_ids.issubset(
            set(self.game.votes.keys())
        )

    def finalize_votes(self) -> VotingResult:
        if self.game.phase != GamePhase.VOTING:
            raise ValueError("투표 단계가 아닙니다.")

        if not self.all_votes_submitted():
            raise ValueError(
                "아직 모든 생존 플레이어가 투표하지 않았습니다."
            )

        counts = Counter(self.game.votes.values())

        skip_count = counts.pop(self.SKIP, 0)

        result = VotingResult(
            vote_counts=dict(counts),
            skip_count=skip_count
        )

        if counts:
            highest = max(counts.values())

            winners = [
                player_id
                for player_id, count in counts.items()
                if count == highest
            ]

            if len(winners) == 1 and highest > skip_count:
                eliminated_id = winners[0]

                self.game.players[eliminated_id].is_alive = False

                result.eliminated_id = eliminated_id

                self.events.create_event(
                    event_type=EventType.PLAYER_ELIMINATED,
                    target_id=eliminated_id,
                    payload={
                        "reason": "vote"
                    },
                    visibility=EventVisibility.PUBLIC
                )

            elif len(winners) > 1:
                result.is_tie = True

        self.events.create_event(
            event_type=EventType.VOTING_RESULT,
            payload=result.model_dump(),
            visibility=EventVisibility.PUBLIC
        )

        
        # 먼저 회의를 종료한다.
        self.manager.finish_meeting()

        # 투표 결과에 따른 승리 조건 확인
        self.manager.victory.evaluate()

        return result

