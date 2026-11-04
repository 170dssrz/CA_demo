
from agents.agent_factory import AgentFactory

from state.global_state import GlobalGameState

from game.game_manager import GameManager
from game.action_manager import ActionManager
from game.action_types import ActionRequest, ActionType


factory = AgentFactory()
players, agents = factory.create_agents(4)

game = GlobalGameState(
    game_id="game_001",
    players=players
)

manager = GameManager(game)
manager.start_game(mafia_count=1)

actions = ActionManager(manager)

# AI 001 이동
result = actions.execute(
    ActionRequest(
        actor_id="ai_001",
        action_type=ActionType.MOVE,
        payload={"location": "cafeteria"}
    )
)

print("이동:", result.success)
print("현재 위치:", game.players["ai_001"].location)

# AI 002도 식당으로 이동
actions.execute(
    ActionRequest(
        actor_id="ai_002",
        action_type=ActionType.MOVE,
        payload={"location": "cafeteria"}
    )
)

# 테스트용 시체 생성
body = actions.bodies.create_body("ai_002")

print("시체 위치:", body.location)

# AI 001이 시체 발견
found = actions.bodies.discover_body(
    player_id="ai_001",
    body_id=body.body_id
)

print("시체 발견:", found.body_id)

# 시체 신고
result = actions.execute(
    ActionRequest(
        actor_id="ai_001",
        action_type=ActionType.REPORT_BODY,
        payload={"body_id": body.body_id}
    )
)

print("신고 성공:", result.success)
print("현재 단계:", game.phase.value)
print("신고 여부:", body.is_reported)

# 중복 신고 시도
result = actions.execute(
    ActionRequest(
        actor_id="ai_001",
        action_type=ActionType.REPORT_BODY,
        payload={"body_id": body.body_id}
    )
)

print("중복 신고:", result.success)
print("오류 메시지:", result.message)
