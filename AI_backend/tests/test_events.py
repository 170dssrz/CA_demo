
from events.event_manager import EventManager
from events.event_types import EventType, EventVisibility


manager = EventManager(game_id="game_001")

manager.create_event(
    event_type=EventType.PLAYER_SPOKE,
    actor_id="ai_001",
    payload={"text": "도윤이 조금 수상한데?"}
)

manager.create_event(
    event_type=EventType.NIGHT_ACTION,
    actor_id="ai_002",
    payload={"action": "investigate", "target": "ai_003"},
    visibility=EventVisibility.PRIVATE,
    audience=["ai_002"]
)

print("전체 이벤트 수:", len(manager.events))

print("\nAI 001이 볼 수 있는 이벤트:")
for event in manager.get_events_for("ai_001"):
    print(event.sequence, event.event_type.value)

print("\nAI 002가 볼 수 있는 이벤트:")
for event in manager.get_events_for("ai_002"):
    print(event.sequence, event.event_type.value)
