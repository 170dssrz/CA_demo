using System;
using System.Collections;
using System.Collections.Generic;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

// AIWander 이동과 독립적인 목격 감지 및 Python 기억 전송.
public class AISightDetector : MonoBehaviour
{
    [Header("목격 범위")]
    [Min(0.1f)] public float sightRadius = 3f;
    [Min(0.1f)] public float checkInterval = 0.5f;
    [Min(0f)] public float reportCooldown = 5f;

    [Header("벽 가림 판정 (선택)")]
    public LayerMask wallLayers;

    [Header("Python 기억 서버 (로컬 테스트)")]
    public bool sendToPython = true;
    public string pythonBaseUrl = "http://127.0.0.1:8000";
    public GameServer gameServer;

    private float nextCheckTime;
    private readonly Dictionary<EntityId, float> lastReportedAt = new Dictionary<EntityId, float>();

    [Serializable]
    private class MemoryRequest
    {
        public string event_id;
        public float game_time;
        public string location;
        public string actor_id;
        public string target_id;
        public string observer_id;
        public string event_type;
        public string content;
        public string source;
    }

    private void Update()
    {
        if (Time.time < nextCheckTime) return;
        nextCheckTime = Time.time + checkInterval;

        AICharacter observer = GetComponent<AICharacter>();
        if (observer == null) observer = GetComponentInParent<AICharacter>();
        if (observer == null || string.IsNullOrEmpty(observer.playerId)) return;

        AIWander[] candidates = UnityEngine.Object.FindObjectsByType<AIWander>();
        foreach (AIWander candidate in candidates)
        {
            if (candidate == null || !candidate.isActiveAndEnabled) continue;

            AICharacter other = candidate.GetComponent<AICharacter>();
            if (other == null) other = candidate.GetComponentInChildren<AICharacter>(true);
            if (other == null || other == observer || string.IsNullOrEmpty(other.playerId)) continue;
            if (other.playerId == observer.playerId) continue;

            Vector2 from = observer.transform.position;
            Vector2 to = other.transform.position;
            if (Vector2.Distance(from, to) > sightRadius) continue;
            if (wallLayers.value != 0 && Physics2D.Linecast(from, to, wallLayers)) continue;

            EntityId id = other.gameObject.GetEntityId();
            if (lastReportedAt.TryGetValue(id, out float lastTime) &&
                Time.time - lastTime < reportCooldown) continue;

            lastReportedAt[id] = Time.time;
            Debug.Log($"[AI 목격] {observer.displayName}({observer.playerId}) -> {other.displayName}({other.playerId}) | t={Time.time:F1} | pos={to}", this);

            if (!sendToPython) continue;
            MemoryRequest memory = new MemoryRequest
            {
                event_id = Guid.NewGuid().ToString("N"),
                game_time = Time.time,
                location = $"x:{to.x:F2},y:{to.y:F2}",
                actor_id = other.playerId,
                target_id = other.playerId,
                observer_id = observer.playerId,
                event_type = "PLAYER_SEEN",
                content = $"{observer.displayName}이(가) 좌표 ({to.x:F2}, {to.y:F2})에서 {other.displayName}을(를) 목격했다.",
                source = "observation"
            };
            StartCoroutine(SendMemory(memory));
        }
    }

    private IEnumerator SendMemory(MemoryRequest memory)
    {
        if (gameServer == null)
            gameServer = FindAnyObjectByType<GameServer>();

        if (gameServer == null || string.IsNullOrEmpty(gameServer.currentGameId))
        {
            Debug.LogWarning("[기억 저장 대기] 현재 게임 ID가 아직 없습니다.", this);
            yield break;
        }

        string gameId = gameServer.currentGameId;

        string url = pythonBaseUrl.TrimEnd('/') +
                    "/games/" +
                    UnityWebRequest.EscapeURL(gameId) +
                    "/memories";

        string json = JsonUtility.ToJson(memory);

        Debug.Log("[기억 전송 JSON] " + json);

        byte[] bytes = Encoding.UTF8.GetBytes(json);

        using (UnityWebRequest request = new UnityWebRequest(url, "POST"))
        {
            request.uploadHandler = new UploadHandlerRaw(bytes);
            request.downloadHandler = new DownloadHandlerBuffer();
            request.SetRequestHeader("Content-Type", "application/json");
            request.timeout = 8;
            yield return request.SendWebRequest();

            if (request.result == UnityWebRequest.Result.Success)
                Debug.Log($"[기억 저장 성공] {memory.observer_id} -> {memory.actor_id} | {memory.location}", this);
            else
                Debug.LogWarning($"[기억 저장 실패] HTTP {request.responseCode} | {request.error} | {request.downloadHandler.text}", this);
        }
    }
}
