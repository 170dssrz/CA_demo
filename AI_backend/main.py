
from fastapi import FastAPI

app = FastAPI(
    title="AI Mafia Backend",
    version="1.0.0"
)

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "message": "AI Mafia Python Backend is running"
    }


from fastapi import HTTPException
from pydantic import BaseModel

from agents.agent_factory import AgentFactory
from state.global_state import GlobalGameState
from game.game_manager import GameManager
from game.action_manager import ActionManager


class CreateGameRequest(BaseModel):
    ai_count: int = 4
    mafia_count: int = 1


# 테스트용 게임 저장소
games = {}


@app.post("/games")
def create_game(request: CreateGameRequest):
    try:
        factory = AgentFactory()

        players, agents = factory.create_agents(
            request.ai_count
        )

        game = GlobalGameState(
            game_id="test_game",
            players=players
        )

        manager = GameManager(game)
        manager.start_game(
            mafia_count=request.mafia_count
        )

        actions = ActionManager(manager)

        games[game.game_id] = {
            "manager": manager,
            "actions": actions,
            "agents": agents
        }

        return {
            "game_id": game.game_id,
            "status": game.status.value,
            "phase": game.phase.value,
            "players": manager.roles.get_public_roster()
        }

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error)
        )
