
from agents.character_generator import CharacterGenerator


generator = CharacterGenerator()

characters = generator.generate(count=4)

for character in characters:
    print("=" * 40)
    print("이름:", character.name)
    print("성격 ID:", character.personality_id)
    print("Seed ID:", character.seed_memory.seed_id)
    print("Seed Memory:", character.seed_memory.description)
