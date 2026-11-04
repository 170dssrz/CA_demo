
import random

from state.global_state import GlobalGameState
from state.enums import PlayerRole, Team, GameStatus


class RoleManager:
    def __init__(self, game: GlobalGameState):
        self.game = game

    def assign_roles(self, mafia_count: int = 1):
        if self.game.status != GameStatus.WAITING:
            raise ValueError(
                "게임 시작 전에만 직업을 배정할 수 있습니다."
            )

        players = list(self.game.players.values())
        player_count = len(players)

        if not (1 <= mafia_count < player_count / 2):
            raise ValueError(
                "마피아 수는 1명 이상이며 전체 인원의 절반 미만이어야 합니다."
            )

        # 직업 배정은 한 번만 허용
        if getattr(self, "_assigned", False):
            raise ValueError("이미 직업이 배정되었습니다.")

        mafia_ids = set(
            random.sample(
                [player.player_id for player in players],
                mafia_count
            )
        )

        for player in players:
            if player.player_id in mafia_ids:
                player.role = PlayerRole.MAFIA
                player.team = Team.MAFIA
            else:
                player.role = PlayerRole.CITIZEN
                player.team = Team.CITIZEN

        self._assigned = True

    def get_own_role(self, player_id: str) -> dict:
        player = self.game.players.get(player_id)

        if player is None:
            raise ValueError("존재하지 않는 플레이어입니다.")

        return {
            "player_id": player.player_id,
            "role": player.role.value,
            "team": player.team.value
        }

    def get_public_roster(self) -> list[dict]:
        return [
            {
                "player_id": player.player_id,
                "name": player.name,
                "is_alive": player.is_alive
            }
            for player in self.game.players.values()
        ]

    def get_teammates(self, player_id: str) -> list[str]:
        player = self.game.players.get(player_id)

        if player is None:
            raise ValueError("존재하지 않는 플레이어입니다.")

        if player.team != Team.MAFIA:
            return []

        return [
            other.player_id
            for other in self.game.players.values()
            if other.team == Team.MAFIA
            and other.player_id != player_id
        ]
