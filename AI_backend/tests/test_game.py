
from agents.agent_factory import AgentFactory

from state.global_state import GlobalGameState
from state.enums import GamePhase

from game.game_manager import GameManager


factory = AgentFactory()
players, agents = factory.create_agents(4)

game = GlobalGameState(
    game_id="game_001",
    players=players
)

manager = GameManager(game)

# 게임 시작
manager.start_game()

print("게임 상태:", game.status.value)
print("현재 단계:", game.phase.value)

# 밤으로 변경
manager.change_phase(GamePhase.NIGHT)

print("밤 전환:", game.phase.value)

# AI 001이 긴급 회의 소집
manager.call_meeting(
    caller_id="ai_001",
    reason="emergency"
)

print("회의 시작:", game.phase.value)
print("이전 단계:", game.previous_phase.value)

# 투표 단계로 전환
manager.start_voting()

print("투표 시작:", game.phase.value)

# 회의 종료
manager.finish_meeting()

print("회의 종료:", game.phase.value)

# 다음 낮으로 변경
manager.change_phase(GamePhase.DAY)

print("현재 날짜:", game.day)
print("현재 단계:", game.phase.value)

print("\n이벤트 기록:")
for event in manager.events.events:
    print(
        event.sequence,
        event.event_type.value,
        event.payload
    )
