
from agents.agent_factory import AgentFactory

from state.global_state import GlobalGameState
from state.enums import GamePhase

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

# 이동
result = actions.execute(
    ActionRequest(
        actor_id="ai_001",
        action_type=ActionType.MOVE,
        payload={"location": "cafeteria"}
    )
)

print("이동:", result.model_dump())

# 대화
result = actions.execute(
    ActionRequest(
        actor_id="ai_002",
        action_type=ActionType.SPEAK,
        target_id="ai_001",
        payload={"text": "아까 어디 있었어?"}
    )
)

print("대화:", result.model_dump())

# 긴급 회의
result = actions.execute(
    ActionRequest(
        actor_id="ai_001",
        action_type=ActionType.CALL_MEETING
    )
)

print("회의:", result.model_dump())
print("현재 단계:", game.phase.value)

# 회의 중 이동 시도
result = actions.execute(
    ActionRequest(
        actor_id="ai_002",
        action_type=ActionType.MOVE,
        payload={"location": "hall"}
    )
)

print("회의 중 이동:", result.model_dump())
