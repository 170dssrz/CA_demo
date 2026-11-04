
from agents.agent_factory import AgentFactory
from state.global_state import GlobalGameState
from game.role_manager import RoleManager


factory = AgentFactory()

players, agents = factory.create_agents(6)

game = GlobalGameState(
    game_id="game_001",
    players=players
)

role_manager = RoleManager(game)

# 마피아 2명 배정
role_manager.assign_roles(mafia_count=2)

print("=== 공개 플레이어 목록 ===")

for player in role_manager.get_public_roster():
    print(player)

print("\n=== 직업 배정 결과 (관리자 테스트용) ===")

for player_id in game.players:
    role = role_manager.get_own_role(player_id)

    print(
        player_id,
        game.players[player_id].name,
        role["role"],
        role["team"]
    )

print("\n=== 마피아 동료 조회 테스트 ===")

for player_id, player in game.players.items():
    if player.team.value == "mafia":
        print(
            player.name,
            "동료:",
            role_manager.get_teammates(player_id)
        )
