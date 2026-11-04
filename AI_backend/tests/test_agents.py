
from agents.agent_factory import AgentFactory
from state.global_state import GlobalGameState


factory = AgentFactory()

players, agents = factory.create_agents(count=4)

game = GlobalGameState(
    game_id="game_001",
    players=players
)

print("게임 ID:", game.game_id)
print("플레이어 수:", len(game.players))
print("AI 에이전트 수:", len(agents))

for agent_id, agent in agents.items():
    print("\n" + "=" * 40)

    print("Agent ID:", agent.agent_id)
    print("이름:", agent.personality.name)

    print(
        "Seed Memory:",
        agent.personality.seed_memory.description
    )

    print("감정:", agent.emotions.model_dump())

    print(
        "관계 대상:",
        list(agent.relationships.keys())
    )

    print("기억:", agent.memory_ids)
    print("목표:", agent.goals)
