
import json
import random
from pathlib import Path

from agents.personality import Personality
from memory.seed_memory import SeedMemory


DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def load_json(filename: str):
    with open(DATA_DIR / filename, "r", encoding="utf-8") as file:
        return json.load(file)


class CharacterGenerator:
    def __init__(self):
        self.names = load_json("names.json")
        self.seeds = load_json("seed_personas.json")

    def generate(self, count: int) -> list[Personality]:
        if count < 1:
            raise ValueError("캐릭터 수는 1명 이상이어야 합니다.")

        if count > len(set(self.names)):
            raise ValueError("이름 목록이 부족합니다.")

        seed_ids = [seed["seed_id"] for seed in self.seeds]

        if len(seed_ids) != len(set(seed_ids)):
            raise ValueError("Seed ID가 중복되어 있습니다.")

        if count > len(self.seeds):
            raise ValueError("Seed Memory 목록이 부족합니다.")

        names = random.sample(self.names, count)
        seeds = random.sample(self.seeds, count)

        characters = []

        for index, (name, seed) in enumerate(zip(names, seeds)):
            character = Personality(
                personality_id=f"personality_{index + 1:03d}",
                name=name,
                seed_memory=SeedMemory(
                    seed_id=seed["seed_id"],
                    description=seed["description"]
                )
            )

            characters.append(character)

        return characters
