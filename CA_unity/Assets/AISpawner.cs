using UnityEngine;

// 서버가 정해준 명단(이름, 이미지 번호)대로 AI를 만들어 주는 스크립트.
// 예전의 Start()에서 Spawn(3) 하던 부분은 없앴어요. 이제 GameServer가 명단을 받아서 호출해요.
public class AISpawner : MonoBehaviour
{
    public GameObject aiPrefab;
    public Sprite[] sprites;            // AI가 쓸 수 있는 이미지 목록 (서버가 이 중 번호를 골라줘요)
    public SpriteRenderer background;

    // 지금 있는 AI를 전부 지우고, 명단대로 새로 만든다
    public void SpawnFromRoster(GameServer.AiData[] roster)
    {
        if (aiPrefab == null || sprites == null || sprites.Length == 0)
        {
            Debug.LogError("AISpawner: Ai Prefab과 Sprites를 먼저 연결해주세요.");
            return;
        }

        foreach (var old in FindObjectsByType<AICharacter>())
            Destroy(old.gameObject);

        foreach (var data in roster)
        {
            // 번호가 이미지 수보다 크더라도 안전하게 범위 안으로 맞춤
            int idx = ((data.spriteIndex % sprites.Length) + sprites.Length) % sprites.Length;

            var go = Instantiate(aiPrefab, RandomPos(), Quaternion.identity);
            go.GetComponent<AIWander>().background = background;
            go.GetComponent<AICharacter>().Setup(data.name, sprites[idx]);
        }
    }

    Vector3 RandomPos()
    {
        if (background == null) return Vector3.zero;
        Bounds b = background.bounds;
        return new Vector3(Random.Range(b.min.x, b.max.x), Random.Range(b.min.y, b.max.y), 0f);
    }
}
