
from agents.agent_state import (
    AgentState,
    RelationshipState
)
from agents.character_generator import CharacterGenerator

from state.player_state import PlayerState
from state.enums import PlayerType, PlayerRole, Team


class AgentFactory:
    def __init__(self):
        self.generator = CharacterGenerator()

    def create_agents(self, count: int):
        characters = self.generator.generate(count)

        agents: dict[str, AgentState] = {}
        players: dict[str, PlayerState] = {}

        for index, character in enumerate(characters):
            player_id = f"ai_{index + 1:03d}"

            player = PlayerState(
                player_id=player_id,
                name=character.name,
                player_type=PlayerType.AI,
                role=PlayerRole.CITIZEN,
                team=Team.CITIZEN
            )

            agent = AgentState(
                agent_id=player_id,
                player_id=player_id,
                personality=character
            )

            players[player_id] = player
            agents[player_id] = agent

        # 다른 AI와의 초기 관계 생성
        for agent_id, agent in agents.items():
            for other_id in agents:
                if agent_id != other_id:
                    agent.relationships[other_id] = (
                        RelationshipState()
                    )

        return players, agents
