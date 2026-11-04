
from .game_event import GameEvent
from .event_types import EventType, EventVisibility


class EventManager:
    def __init__(self, game_id: str):
        self.game_id = game_id
        self.events: list[GameEvent] = []
        self.next_sequence = 1

    def create_event(
        self,
        event_type: EventType,
        actor_id: str | None = None,
        target_id: str | None = None,
        payload: dict | None = None,
        visibility: EventVisibility = EventVisibility.PUBLIC,
        audience: list[str] | None = None
    ) -> GameEvent:

        event = GameEvent(
            game_id=self.game_id,
            sequence=self.next_sequence,
            event_type=event_type,
            actor_id=actor_id,
            target_id=target_id,
            payload=payload or {},
            visibility=visibility,
            audience=audience or []
        )

        self.events.append(event)
        self.next_sequence += 1

        return event

    def get_events_for(
        self,
        player_id: str,
        team: str | None = None
    ) -> list[GameEvent]:

        result = []

        for event in self.events:
            if event.visibility == EventVisibility.PUBLIC:
                result.append(event)

            elif event.visibility == EventVisibility.PRIVATE:
                if player_id in event.audience:
                    result.append(event)

            elif event.visibility == EventVisibility.TEAM:
                if team is not None and team in event.audience:
                    result.append(event)

        return result
