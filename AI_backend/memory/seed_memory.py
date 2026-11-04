
from pydantic import BaseModel, Field


class SeedMemory(BaseModel):
    seed_id: str
    description: str = Field(min_length=1)
