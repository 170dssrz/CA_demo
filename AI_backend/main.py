from state.player_state import PlayerState
from state.enums import PlayerType, PlayerRole, Team
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

        print(
            f"[Game Create] ai_count={request.ai_count}, "
            f"mafia_count={request.mafia_count}",
            flush=True
        )

        players, agents = factory.create_agents(
            request.ai_count
        )

        # Unity에서 조작하는 사람 플레이어 등록
        human_id = "human_0"

        players[human_id] = PlayerState(
            player_id=human_id,
            name="나",
            player_type=PlayerType.HUMAN,
            role=PlayerRole.CITIZEN,
            team=Team.CITIZEN
        )

        print(
            f"[Game Create] 사람 플레이어 등록: {human_id}",
            flush=True
)

        print(
            f"[Game Create] AgentFactory 성공: {len(players)}명",
            flush=True
        )


        game = GlobalGameState(
            game_id="test_game",
            players=players
        )

        manager = GameManager(game)

        print("[Game Create] GameManager 시작", flush=True)

        manager.start_game(
            mafia_count=request.mafia_count
        )

        print("[Game Create] GameManager 성공", flush=True)

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
            "players": manager.roles.get_public_roster(),
            "ai_characters": [
                {
                    "player_id": player_id,
                    "name": players[player_id].name,
                    "personality": {
                        "seed_id": agent.personality.seed_memory.seed_id,
                        "description": agent.personality.seed_memory.description
                    }
                }
                for player_id, agent in agents.items()
            ]
        }


    except ValueError as error:
        print(f"[Game Create] 오류: {error}", flush=True)
        raise HTTPException(
            status_code=400,
            detail=str(error)
        )


class MeetingRequest(BaseModel):
    caller_id: str
    reason: str = "emergency"


@app.post("/games/{game_id}/meeting")
def start_meeting(game_id: str, request: MeetingRequest):
    game_data = games.get(game_id)

    if game_data is None:
        raise HTTPException(
            status_code=404,
            detail="게임을 찾을 수 없습니다."
        )

    manager = game_data["manager"]

    try:
        manager.call_meeting(
            caller_id=request.caller_id,
            reason=request.reason
        )

        return {
            "game_id": game_id,
            "status": manager.game.status.value,
            "phase": manager.game.phase.value,
            "message": "회의가 시작되었습니다."
        }

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error)
        )


@app.post("/games/{game_id}/voting/start")
def start_voting(game_id: str):
    game_data = games.get(game_id)

    if game_data is None:
        raise HTTPException(
            status_code=404,
            detail="게임을 찾을 수 없습니다."
        )

    manager = game_data["manager"]

    try:
        manager.start_voting()

        return {
            "game_id": game_id,
            "status": manager.game.status.value,
            "phase": manager.game.phase.value,
            "message": "투표가 시작되었습니다."
        }

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error)
        )


from game.action_types import ActionType, ActionRequest


class VoteRequest(BaseModel):
    voter_id: str
    target_id: str


@app.post("/games/{game_id}/vote")
def submit_vote(game_id: str, request: VoteRequest):
    game_data = games.get(game_id)

    if game_data is None:
        raise HTTPException(
            status_code=404,
            detail="게임을 찾을 수 없습니다."
        )

    actions = game_data["actions"]

    result = actions.execute(
        ActionRequest(
            actor_id=request.voter_id,
            action_type=ActionType.VOTE,
            target_id=request.target_id
        )
    )

    if not result.success:
        raise HTTPException(
            status_code=400,
            detail=result.message
        )

    return {
        "game_id": game_id,
        "voter_id": request.voter_id,
        "message": result.message,
        "event_id": result.event_id
    }


@app.post("/games/{game_id}/voting/finalize")
def finalize_voting(game_id: str):
    game_data = games.get(game_id)

    if game_data is None:
        raise HTTPException(
            status_code=404,
            detail="게임을 찾을 수 없습니다."
        )

    manager = game_data["manager"]
    actions = game_data["actions"]

    try:
        result = actions.voting.finalize_votes()

        return {
            "game_id": game_id,
            "status": manager.game.status.value,
            "phase": manager.game.phase.value,
            "winner": (
                manager.game.winner.value
                if manager.game.winner is not None
                else None
            ),
            "voting_result": result.model_dump(),
            "players": manager.roles.get_public_roster()
        }

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error)
        )


@app.get("/games/{game_id}/state")
def get_game_state(game_id: str):
    game_data = games.get(game_id)

    if game_data is None:
        raise HTTPException(
            status_code=404,
            detail="게임을 찾을 수 없습니다."
        )

    manager = game_data["manager"]
    game = manager.game

    return {
        "game_id": game.game_id,
        "status": game.status.value,
        "phase": game.phase.value,
        "winner": (
            game.winner.value
            if game.winner is not None
            else None
        ),
        "players": manager.roles.get_public_roster()
    }

# -----------------------------
# ARTEM-inspired episodic memory endpoints (Unity integration step 1)
# -----------------------------
from pathlib import Path
import os
import sqlite3
from uuid import uuid4
from memory.memory_event import MemoryEvent, MemorySource
from memory.memory_store import MemoryStore

MEMORY_DB_PATH = os.getenv(
    "MEMORY_DB_PATH", str(Path(__file__).resolve().parent / "memory.db")
)


class RecordMemoryRequest(BaseModel):
    observer_id: str
    game_time: float
    location: str
    actor_id: str
    event_type: str
    content: str
    target_id: str | None = None
    source: MemorySource = MemorySource.OBSERVATION
    informant_id: str | None = None
    event_id: str | None = None


def _check_memory_game(game_id: str, observer_id: str):
    game_data = games.get(game_id)
    if game_data is None:
        raise HTTPException(status_code=404, detail="게임을 찾을 수 없습니다.")
    if observer_id not in game_data["agents"]:
        raise HTTPException(status_code=404, detail="해당 게임에 AI 관찰자가 없습니다.")
    return game_data


@app.post("/games/{game_id}/memories", status_code=201)
def record_memory(game_id: str, request: RecordMemoryRequest):
    _check_memory_game(game_id, request.observer_id)
    game = games[game_id]["manager"].game
    if request.actor_id not in game.players:
        raise HTTPException(status_code=400, detail="존재하지 않는 행동자입니다.")
    if request.target_id is not None and request.target_id not in game.players:
        raise HTTPException(status_code=400, detail="존재하지 않는 대상입니다.")
    if request.informant_id is not None and request.informant_id not in game.players:
        raise HTTPException(status_code=400, detail="존재하지 않는 전달자입니다.")
    try:
        event = MemoryEvent(
            event_id=request.event_id or uuid4().hex,
            game_id=game_id,
            game_time=request.game_time,
            location=request.location,
            actor_id=request.actor_id,
            target_id=request.target_id,
            event_type=request.event_type,
            content=request.content,
            observer_id=request.observer_id,
            source=request.source,
            informant_id=request.informant_id,
        )
        MemoryStore(MEMORY_DB_PATH).save(event)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="이미 저장된 사건 ID입니다.")
    return {"ok": True, "event": event.model_dump(mode="json")}


@app.get("/games/{game_id}/memories/{observer_id}")
def list_memories(game_id: str, observer_id: str):
    _check_memory_game(game_id, observer_id)
    events = MemoryStore(MEMORY_DB_PATH).get_memories(game_id, observer_id)
    return {"game_id": game_id, "observer_id": observer_id,
            "count": len(events),
            "events": [e.model_dump(mode="json") for e in events]}
