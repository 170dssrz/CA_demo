using System;
using System.Collections;
using System.Text;
using TMPro;
using UnityEngine;
using UnityEngine.Networking;

// 서버 주소 설정 + 게임 시작 시 AI 명단을 받아와 생성하는 스크립트.
// 서버 주소는 여기 한 곳에서만 바꾸면 돼요 (ChatUI도 이 설정을 같이 씀).
public class GameServer : MonoBehaviour
{
    [Header("서버")]
    public string serverUrl = "https://ai-backend-fmrg.onrender.com";   // 배포 후엔 https://내서비스.onrender.com
    public string roomId = "main";
    public string myName = "나";

    [Header("AI 생성")]
    public int aiCount = 0;          // 0이면 서버가 3~5명 중 랜덤으로 정함
    public AISpawner spawner;
    public TMP_Text statusText;      // (선택) 화면에 연결 상태를 한국어로 표시 (비우면 왼쪽 위에 영어로 작게 표시)

    [Header("연결 자동 점검")]
    public bool autoCheck = true;    // 켜두면 몇 초마다 서버 상태를 확인하고, 문제를 화면에 알려주고, 고칠 수 있는 건 스스로 고침
    public float checkInterval = 5f;

    // 서버와 주고받는 JSON 형식
    
    [Serializable]
    public class AiData
    {
        public string playerId;
        public string name;
        public int spriteIndex;
    }

    [Serializable] public class RosterRequest { public string roomId; public int count; public int spriteCount; }
    [Serializable] public class RosterResponse { public AiData[] roster; }
    
    [Serializable]
    public class PythonPlayer
    {
        public string player_id;
        public string name;
        public bool is_alive;
    }

    [Serializable]
    public class PythonGame
    {
        public string game_id;
        public string status;
        public string phase;
        public PythonPlayer[] players;
    }

    [Serializable]
    public class PythonGameResponse
    {
        public bool ok;
        public PythonGame game;
    }

    [Serializable] public class HealthResponse { public bool ok; public bool mock; public string model; public bool hasKey; public string api; public string apiError; public int rosterCount; }
    [Serializable] public class RestoreRequest { public string roomId; public AiData[] roster; }

    AiData[] currentRoster;          // 지금 화면에 있는 AI 명단 (서버가 명단을 잃어버렸을 때 복구용)
    bool starting, restoring, restoreUnsupported;
    string hudKo = "", hudEn = "";
    Color hudColor = Color.white;

    public string Url(string path)
    {
        return serverUrl.TrimEnd('/') + path;
    }


    IEnumerator Start()
    {
        if (autoCheck)
            StartCoroutine(HealthLoop());

        starting = true;


        yield return NewGame();

        // 게임은 /api/roster에서 이미 생성하므로
        // CreatePythonGame()을 다시 호출하지 않는다.

        starting = false;
    }


    // 몇 초마다 서버 상태를 확인해서 (1) 화면에 원인을 알려주고 (2) 고칠 수 있는 건 스스로 고침
    IEnumerator HealthLoop()
    {
        while (true)
        {
            using (var www = UnityWebRequest.Get(Url("/api/health") + "?roomId=" + UnityWebRequest.EscapeURL(roomId)))
            {
                www.timeout = 8;
                yield return www.SendWebRequest();

                if (www.result != UnityWebRequest.Result.Success)
                {
                    Hud(Color.red, "서버에 연결 안 됨 (" + serverUrl + ") - 서버가 켜져 있는지, 주소가 맞는지 확인하세요",
                                   "ERROR: server unreachable (" + serverUrl + ")");
                }
                else
                {
                    var h = JsonUtility.FromJson<HealthResponse>(www.downloadHandler.text);
                    if (h == null) { Hud(Color.red, "서버 응답을 읽지 못했어요", "ERROR: bad server response"); }
                    else if (!starting && currentRoster == null)
                    {
                        // 서버가 늦게 켜졌거나 처음 연결이 실패했던 경우: AI를 지금 만든다
                        starting = true;
                        Hud(Color.yellow, "AI를 불러오는 중...", "Loading AIs...");
                        yield return NewGame();
                        starting = false;
                    }
                    else if (h.rosterCount == 0 && currentRoster != null && restoreUnsupported)
                    {
                        Hud(Color.red, "서버가 예전 버전이에요 (명단 복구 기능 없음). server.js를 최신으로 바꾸고 서버를 껐다 다시 켜세요",
                                       "ERROR: server is outdated - replace server.js and restart it");
                    }
                    else if (h.rosterCount == 0 && currentRoster != null && !restoring)
                    {
                        // 서버가 AI 명단을 잃어버렸어요(재시작 등): 화면에 있는 AI로 자동 복구
                        restoring = true;
                        Hud(Color.yellow, "서버가 AI 정보를 잃어버려서 복구하는 중...", "Restoring AI roster...");
                        yield return RestoreRoster();
                        restoring = false;
                    }
                    else if (!h.hasKey) Hud(Color.red, "서버에 API 키가 없어요 (.env 의 ANTHROPIC_API_KEY 확인)", "ERROR: no API key on server");
                    else if (h.api == "error") Hud(Color.red, "Claude 오류: " + h.apiError, "ERROR: Claude call failed (see Console / server window)");
                    else if (h.mock) Hud(Color.yellow, "테스트 모드: AI가 가짜 답장을 해요 (.env 의 MOCK_AI 를 지우세요)", "MOCK mode (fake replies)");
                    else Hud(Color.green, "연결됨 · AI " + h.rosterCount + "명 · Claude 정상", "OK: connected, AI " + h.rosterCount);

                    if (h != null && h.api == "error") Debug.LogWarning("[GameServer] Claude 오류: " + h.apiError);
                }
            }
            yield return new WaitForSeconds(checkInterval);
        }
    }

    // 상태 표시 (바뀔 때만 Console에 남김)
    void Hud(Color color, string ko, string en)
    {
        if (ko != hudKo) Debug.Log("[GameServer] " + ko);
        hudKo = ko; hudEn = en; hudColor = color;
        if (statusText != null) { statusText.text = ko; statusText.color = color; }
    }

    // statusText를 연결하지 않았을 때를 위한 간단한 표시 (한글 글꼴 문제를 피하려고 영어)
    void OnGUI()
    {
        if (!autoCheck || statusText != null || string.IsNullOrEmpty(hudEn)) return;
        var prev = GUI.color;
        GUI.color = hudColor;
        GUI.Label(new Rect(10, 6, 900, 24), hudEn);
        GUI.color = prev;
    }

    // 버튼에 연결해서 "새 게임" 용으로도 쓸 수 있어요
    public void RestartGame()
    {
        StartCoroutine(NewGame());
    }

    public IEnumerator NewGame()
    {
        if (spawner == null || spawner.sprites == null || spawner.sprites.Length == 0)
        {
            SetStatus("AISpawner의 Sprites에 이미지를 한 장 이상 넣어주세요.");
            yield break;
        }

        SetStatus("AI를 불러오는 중...");

        var req = new RosterRequest
        {
            roomId = roomId,
            count = aiCount,
            spriteCount = spawner.sprites.Length
        };
        byte[] body = Encoding.UTF8.GetBytes(JsonUtility.ToJson(req));

        using (var www = new UnityWebRequest(Url("/api/roster"), "POST"))
        {
            www.uploadHandler = new UploadHandlerRaw(body);
            www.downloadHandler = new DownloadHandlerBuffer();
            www.SetRequestHeader("Content-Type", "application/json");
            www.timeout = 90;   // Render 무료 서버가 잠들어 있으면 첫 응답이 느려요

            yield return www.SendWebRequest();

            if (www.result != UnityWebRequest.Result.Success)
            {
                SetStatus("서버에 연결하지 못했어요. (" + www.error + ")");
                yield break;
            }

            RosterResponse res = JsonUtility.FromJson<RosterResponse>(www.downloadHandler.text);
            if (res == null || res.roster == null)
            {
                SetStatus("서버 응답을 읽지 못했어요.");
                yield break;
            }

            
            currentRoster = res.roster;

            foreach (var ai in currentRoster)
            {
                Debug.Log(
                    "[AI Roster] ID: " + ai.playerId +
                    " / 이름: " + ai.name
                );
            }

            spawner.SpawnFromRoster(res.roster);
            SetStatus("");

        }
    }

    
    public IEnumerator CreatePythonGame()
    {
        using (var www = new UnityWebRequest(
            Url("/api/game/create"), "POST"))
        {
            www.uploadHandler = new UploadHandlerRaw(
                Encoding.UTF8.GetBytes("{}")
            );

            www.downloadHandler = new DownloadHandlerBuffer();

            www.SetRequestHeader(
                "Content-Type",
                "application/json"
            );

            www.timeout = 30;

            yield return www.SendWebRequest();

            if (www.result != UnityWebRequest.Result.Success)
            {
                Debug.LogError(
                    "[Python Game] 연결 실패: " +
                    www.error + " / " +
                    www.downloadHandler.text
                );
                yield break;
            }

            PythonGameResponse response =
                JsonUtility.FromJson<PythonGameResponse>(
                    www.downloadHandler.text
                );

            if (response == null ||
                !response.ok ||
                response.game == null)
            {
                Debug.LogError(
                    "[Python Game] 응답 처리 실패"
                );
                yield break;
            }

            Debug.Log(
                "[Python Game] 생성 성공! ID: " +
                response.game.game_id
            );

            Debug.Log(
                "[Python Game] 현재 단계: " +
                response.game.phase
            );

            if (response.game.players != null)
            {
                foreach (var player in response.game.players)
                {
                    Debug.Log(
                        "[Python Player] " +
                        player.player_id + " / " +
                        player.name
                    );
                }
            }
        }
    }


    // 서버가 재시작/절전으로 AI 명단을 잃어버렸을 때: 화면에 있는 AI의 이름과 이미지를 서버에 다시 알려 줌
    // (AI는 화면에서 그대로 유지되고, 서버 쪽 성격과 기억만 새로 만들어져요)
    public IEnumerator RestoreRoster()
    {
        if (currentRoster == null || currentRoster.Length == 0) yield break;

        var req = new RestoreRequest { roomId = roomId, roster = currentRoster };
        byte[] body = Encoding.UTF8.GetBytes(JsonUtility.ToJson(req));

        using (var www = new UnityWebRequest(Url("/api/roster/restore"), "POST"))
        {
            www.uploadHandler = new UploadHandlerRaw(body);
            www.downloadHandler = new DownloadHandlerBuffer();
            www.SetRequestHeader("Content-Type", "application/json");
            www.timeout = 60;
            yield return www.SendWebRequest();

            if (www.result != UnityWebRequest.Result.Success)
            {
                if (www.responseCode == 404) restoreUnsupported = true;   // 서버가 예전 버전이라 복구 주소 자체가 없음
                Debug.LogWarning("[GameServer] 명단 복구 실패: " + www.error);
            }
            else
            {
                restoreUnsupported = false;
                Debug.Log("[GameServer] 서버 AI 명단을 복구했어요.");
            }
        }
    }

    void SetStatus(string msg)
    {
        if (statusText != null) statusText.text = msg;
        if (!string.IsNullOrEmpty(msg)) Debug.Log("[GameServer] " + msg);
    }
}