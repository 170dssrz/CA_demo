using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Tilemaps;

// 서버 명단에 따라 AI를 생성하고 생성한 AI 목록을 관리한다.
public class AISpawner : MonoBehaviour
{
    // 기존 캐릭터 방식도 유지 (Inspector 연결 보존)
    public GameObject aiPrefab;
    public Sprite[] sprites;
    public SpriteRenderer background;

    // 등록된 SPUM 프리팹 중 매 AI마다 무작위 선택 (중복 허용)
    public GameObject[] spumPrefabs;

    [Header("RAF AI 이동 가능 타일맵")]
    public Tilemap walkableTilemap;

    [Header("생성 위치 충돌 검사")]
    public LayerMask blockingLayers;
    [Min(0f)] public float spawnClearanceRadius = 0.25f;

    private readonly List<Vector3> validSpawnPositions = new List<Vector3>();

    private readonly List<AICharacter> spawnedAI = new List<AICharacter>();
    public IReadOnlyList<AICharacter> SpawnedAI => spawnedAI;
    private readonly List<GameObject> spawnedRoots = new List<GameObject>();

    public void SpawnFromRoster(GameServer.AiData[] roster)
    {
        bool useSpum = spumPrefabs != null && spumPrefabs.Length > 0;

        if (!useSpum && (aiPrefab == null || sprites == null || sprites.Length == 0))
        {
            Debug.LogError("AISpawner: SPUM Prefabs 또는 기존 Ai Prefab과 Sprites를 연결해주세요.");
            return;
        }
        if (roster == null)
        {
            Debug.LogError("AISpawner: 서버 명단이 없습니다.");
            return;
        }

        if (walkableTilemap == null)
        {
            Debug.LogError("AISpawner: Walkable Tilemap에 AI_Walkable을 연결해주세요.");
            return;
        }

        // 이 Spawner가 이전에 생성한 AI만 제거한다.
        foreach (var old in spawnedRoots)
            if (old != null) Destroy(old);
        spawnedRoots.Clear();
        spawnedAI.Clear();

        RebuildSpawnPositions();
        if (validSpawnPositions.Count == 0)
        {
            Debug.LogError("AISpawner: AI_Walkable에 생성 가능한 타일이 없습니다. 타일과 Blocking Layers를 확인하세요.");
            return;
        }

        foreach (var data in roster)
        {
            GameObject prefab;
            Sprite sprite = null;

            if (useSpum)
            {
                int index = Random.Range(0, spumPrefabs.Length);
                prefab = spumPrefabs[index];
                if (prefab == null)
                {
                    Debug.LogError($"AISpawner: SPUM Prefabs[{index}]가 비어 있습니다.");
                    continue;
                }
            }
            else
            {
                int idx = ((data.spriteIndex % sprites.Length) + sprites.Length) % sprites.Length;
                prefab = aiPrefab;
                sprite = sprites[idx];
            }

            if (!TryRandomPos(out Vector3 spawnPosition))
            {
                Debug.LogError("AISpawner: 생성 가능한 위치를 찾지 못했습니다.");
                continue;
            }

            var go = Instantiate(prefab, spawnPosition, Quaternion.identity);
            var wander = go.GetComponent<AIWander>();
            var character = go.GetComponent<AICharacter>();
            if (character == null)
                character = go.GetComponentInChildren<AICharacter>(true);

            if (character == null)
            {
                Debug.LogError($"AISpawner: Prefab '{prefab.name}'의 루트와 자식에서 AICharacter를 찾지 못했습니다. Prefab에 AICharacter를 추가해주세요.");
                Destroy(go);
                continue;
            }

            if (wander != null) wander.background = background;
            if (useSpum) character.SetupSPUM(data.name);
            else character.Setup(data.name, sprite);

            character.SetPlayerId(data.playerId);
            spawnedAI.Add(character);
            spawnedRoots.Add(go);
        }
    }

    // 실제로 타일이 칠해진 셀의 중심 좌표만 후보로 저장한다.
    private void RebuildSpawnPositions()
    {
        validSpawnPositions.Clear();
        BoundsInt bounds = walkableTilemap.cellBounds;

        foreach (Vector3Int cell in bounds.allPositionsWithin)
        {
            if (!walkableTilemap.HasTile(cell)) continue;

            Vector3 worldPos = walkableTilemap.GetCellCenterWorld(cell);
            worldPos.z = 0f;

            // Blocking Layers가 설정된 경우 벽/장애물과 겹치는 위치는 제외.
            if (blockingLayers.value != 0 &&
                Physics2D.OverlapCircle((Vector2)worldPos, spawnClearanceRadius, blockingLayers) != null)
                continue;

            validSpawnPositions.Add(worldPos);
        }
    }

    private bool TryRandomPos(out Vector3 position)
    {
        if (validSpawnPositions.Count == 0)
        {
            position = Vector3.zero;
            return false;
        }

        position = validSpawnPositions[Random.Range(0, validSpawnPositions.Count)];
        return true;
    }
}
