
from pydantic import BaseModel

from memory.seed_memory import SeedMemory


class Personality(BaseModel):
    personality_id: str
    name: str
    seed_memory: SeedMemory
