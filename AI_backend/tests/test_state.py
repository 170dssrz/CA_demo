
from state.enums import PlayerType, PlayerRole, Team
from state.player_state import PlayerState
from state.global_state import GlobalGameState


player = PlayerState(
    player_id="ai_001",
    name="하루",
    player_type=PlayerType.AI,
    role=PlayerRole.CITIZEN,
    team=Team.CITIZEN
)

game = GlobalGameState(
    game_id="game_001",
    players={
        player.player_id: player
    }
)

print(game.model_dump_json(indent=2))
