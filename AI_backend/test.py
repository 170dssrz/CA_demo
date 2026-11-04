
# from agents.agent_factory import AgentFactory

# from state.global_state import GlobalGameState
# from state.enums import GamePhase, Team

# from game.game_manager import GameManager
# from game.action_manager import ActionManager
# from game.action_types import ActionRequest, ActionType


# factory = AgentFactory()

# players, agents = factory.create_agents(4)

# game = GlobalGameState(
#     game_id="game_001",
#     players=players
# )

# manager = GameManager(game)
# manager.start_game(mafia_count=1)

# actions = ActionManager(manager)

# # 마피아와 시민 찾기
# mafia_id = next(
#     pid for pid, player in game.players.items()
#     if player.team == Team.MAFIA
# )

# citizen_ids = [
#     pid for pid, player in game.players.items()
#     if player.team == Team.CITIZEN
# ]

# target_id = citizen_ids[0]

# print("마피아:", mafia_id)
# print("대상:", target_id)

# # 낮에 행동 시도
# result = actions.execute(
#     ActionRequest(
#         actor_id=mafia_id,
#         action_type=ActionType.MAFIA_KILL,
#         target_id=target_id
#     )
# )

# print("낮 행동:", result.success)
# print("메시지:", result.message)

# # 밤으로 전환
# manager.change_phase(GamePhase.NIGHT)

# # 밤에 행동 시도
# result = actions.execute(
#     ActionRequest(
#         actor_id=mafia_id,
#         action_type=ActionType.MAFIA_KILL,
#         target_id=target_id
#     )
# )

# print("\n밤 행동:", result.success)
# print("메시지:", result.message)
# print("대상 생존:", game.players[target_id].is_alive)

# print("생성된 시체:", len(actions.bodies.bodies))

# # 같은 밤에 다시 행동 시도
# second_target = citizen_ids[1]

# result = actions.execute(
#     ActionRequest(
#         actor_id=mafia_id,
#         action_type=ActionType.MAFIA_KILL,
#         target_id=second_target
#     )
# )

# print("\n두 번째 행동:", result.success)
# print("메시지:", result.message)

# # 시민이 마피아 행동 시도
# result = actions.execute(
#     ActionRequest(
#         actor_id=citizen_ids[2],
#         action_type=ActionType.MAFIA_KILL,
#         target_id=mafia_id
#     )
# )

# print("\n시민 행동:", result.success)
# print("메시지:", result.message)

# # 시민이 볼 수 있는 이벤트 확인
# visible = manager.events.get_events_for(
#     player_id=citizen_ids[1],
#     team="citizen"
# )

# print("\n시민에게 공개된 이벤트:")
# for event in visible:
#     print(event.event_type.value)

#####voting


# from agents.agent_factory import AgentFactory

# from state.global_state import GlobalGameState

# from game.game_manager import GameManager
# from game.action_manager import ActionManager
# from game.action_types import ActionRequest, ActionType


# factory = AgentFactory()

# players, agents = factory.create_agents(4)

# game = GlobalGameState(
#     game_id="game_001",
#     players=players
# )

# manager = GameManager(game)
# manager.start_game(mafia_count=1)

# actions = ActionManager(manager)

# # 긴급 회의 시작
# manager.call_meeting("ai_001")

# # 투표 단계 시작
# manager.start_voting()

# print("현재 단계:", game.phase.value)

# votes = {
#     "ai_001": "ai_003",
#     "ai_002": "ai_003",
#     "ai_003": "skip",
#     "ai_004": "ai_003"
# }

# for voter_id, target_id in votes.items():
#     result = actions.execute(
#         ActionRequest(
#             actor_id=voter_id,
#             action_type=ActionType.VOTE,
#             target_id=target_id
#         )
#     )

#     print(
#         voter_id,
#         "투표 성공:",
#         result.success
#     )

# print(
#     "모든 투표 완료:",
#     actions.voting.all_votes_submitted()
# )

# # 투표 결과 집계
# result = actions.voting.finalize_votes()

# print("\n=== 투표 결과 ===")
# print("득표수:", result.vote_counts)
# print("기권:", result.skip_count)
# print("탈락자:", result.eliminated_id)
# print("동점:", result.is_tie)

# print("\n현재 단계:", game.phase.value)

# print(
#     "AI 003 생존:",
#     game.players["ai_003"].is_alive
# )


##### victory


from agents.agent_factory import AgentFactory

from state.global_state import GlobalGameState
from state.enums import Team

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

# 마피아 찾기
mafia_id = next(
    pid for pid, player in game.players.items()
    if player.team == Team.MAFIA
)

citizen_ids = [
    pid for pid, player in game.players.items()
    if player.team == Team.CITIZEN
]

print("마피아:", mafia_id)
print("시민:", citizen_ids)

# 회의 시작
manager.call_meeting(citizen_ids[0])
manager.start_voting()

# 시민 3명은 마피아에게 투표
for citizen_id in citizen_ids:
    actions.execute(
        ActionRequest(
            actor_id=citizen_id,
            action_type=ActionType.VOTE,
            target_id=mafia_id
        )
    )

# 마피아는 기권
actions.execute(
    ActionRequest(
        actor_id=mafia_id,
        action_type=ActionType.VOTE,
        target_id="skip"
    )
)

# 투표 집계
result = actions.voting.finalize_votes()

print("\n=== 결과 ===")
print("탈락자:", result.eliminated_id)
print("게임 상태:", game.status.value)
print("승리 팀:", game.winner.value if game.winner else None)

print("\n=== 게임 종료 이벤트 ===")

for event in manager.events.events:
    if event.event_type.value == "game_ended":
        print(event.payload)
