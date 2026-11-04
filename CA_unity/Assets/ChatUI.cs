using System;
using System.Collections;
using System.Text;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem;
using UnityEngine.Networking;
using UnityEngine.UI;

public class ChatUI : MonoBehaviour
{
    public static bool IsTyping;            // 입력 중이면 캐릭터 이동 정지용

    [Header("UI 연결")]
    public TMP_InputField input;
    public TMP_Text chatLog;
    public ScrollRect scrollRect;

    [Header("서버 설정")]
    public GameServer server;               // 서버 주소·방 이름·내 이름은 GameServer에서 한 번만 설정

    bool justSubmitted;
    bool waiting;                           // AI 답장을 기다리는 중이면 중복 전송 방지

    // 서버와 주고받는 JSON 형식 (JsonUtility용)
    [Serializable] public class ChatRequest
    {
        public string roomId;
        public string sender;
        public string text;
    }
    [Serializable] public class Reply { public string sender; public string text; public float delay; }
    [Serializable] public class ChatResponse { public Reply[] replies; public string reason; }
    [Serializable] public class EventItem { public int id; public string sender; public string text; }
    [Serializable] public class EventsResponse { public EventItem[] events; public int lastId; }
    [Serializable] class MeetingRequest { public string roomId; public bool active; }
    [Serializable] class MeetingResponse { public bool ok; public bool hasRoster; }

    [Header("AI 먼저 말 걸기")]
    public float pollInterval = 2.5f;       // 서버에 "AI가 먼저 한 말 있어?" 물어보는 간격(초)
    int lastEventId;
    Coroutine pollRoutine;

    void Start()
    {
        input.onSubmit.AddListener(OnSubmit);
        input.onSelect.AddListener(_ => IsTyping = true);
        input.onDeselect.AddListener(_ => IsTyping = false);
        chatLog.text = "";
    }

    void Update()
    {
        if (justSubmitted) { justSubmitted = false; return; }

        // 입력 중이 아닐 때 Enter를 누르면 입력창으로 이동
        var kb = Keyboard.current;
        if (!IsTyping && kb != null && kb.enterKey.wasPressedThisFrame && input.gameObject.activeInHierarchy)
            input.ActivateInputField();   // 채팅창이 숨겨져 있을 땐(회의 밖) 무시
    }

    // MeetingManager가 호출: 회의 시작/종료를 서버에 알리고, 회의 중에만 AI의 선발언을 받아옴
    public void SetMeeting(bool active)
    {
        if (pollRoutine != null) { StopCoroutine(pollRoutine); pollRoutine = null; }
        StartCoroutine(PostMeeting(active));
    }

    IEnumerator PostMeeting(bool active)
    {
        var req = new MeetingRequest { roomId = server.roomId, active = active };
        using (var www = new UnityWebRequest(server.Url("/api/meeting"), "POST"))
        {
            www.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(JsonUtility.ToJson(req)));
            www.downloadHandler = new DownloadHandlerBuffer();
            www.SetRequestHeader("Content-Type", "application/json");
            www.timeout = 30;
            yield return www.SendWebRequest();
            if (www.result != UnityWebRequest.Result.Success) { Debug.LogWarning("meeting 알림 실패: " + www.error); yield break; }

            // 회의를 시작하는데 서버에 AI 명단이 없다면(서버 재시작 등) 미리 복구해 둠
            var mr = JsonUtility.FromJson<MeetingResponse>(www.downloadHandler.text);
            if (active && mr != null && !mr.hasRoster) yield return server.RestoreRoster();
        }
        if (active)
        {
            lastEventId = 0;
            pollRoutine = StartCoroutine(PollEvents());
        }
    }

    IEnumerator PollEvents()
    {
        while (true)
        {
            yield return new WaitForSeconds(pollInterval);
            string url = server.Url("/api/events") + "?roomId=" + UnityWebRequest.EscapeURL(server.roomId) + "&since=" + lastEventId;
            using (var www = UnityWebRequest.Get(url))
            {
                www.timeout = 10;
                yield return www.SendWebRequest();
                if (www.result != UnityWebRequest.Result.Success) continue;
                var res = JsonUtility.FromJson<EventsResponse>(www.downloadHandler.text);
                if (res == null || res.events == null) continue;
                foreach (var e in res.events) AddMessage(e.sender, e.text);
                lastEventId = res.lastId;
            }
        }
    }

    void OnSubmit(string text)
    {
        justSubmitted = true;
        text = text.Trim();

        if (!string.IsNullOrEmpty(text))
        {
            if (waiting)
            {
                AddSystem("AI가 답하는 중이에요. 잠시만요.");
            }
            else
            {
                AddMessage(server.myName, text);
                StartCoroutine(SendToServer(text));
            }
        }

        input.text = "";
        EventSystem.current.SetSelectedGameObject(null);   // 포커스 해제 → 다시 이동 가능
        IsTyping = false;
    }

    IEnumerator SendToServer(string text, bool retried = false)
    {
        waiting = true;
        bool needRestore = false;

        var req = new ChatRequest { roomId = server.roomId, sender = server.myName, text = text };
        byte[] body = Encoding.UTF8.GetBytes(JsonUtility.ToJson(req));

        using (var www = new UnityWebRequest(server.Url("/api/chat"), "POST"))
        {
            www.uploadHandler = new UploadHandlerRaw(body);
            www.downloadHandler = new DownloadHandlerBuffer();
            www.SetRequestHeader("Content-Type", "application/json");
            www.timeout = 90;   // Render 무료 서버가 잠들어 있으면 첫 응답이 느려요

            yield return www.SendWebRequest();

            if (www.result != UnityWebRequest.Result.Success)
            {
                string reason = www.responseCode == 429
                    ? "메시지를 너무 빨리 보냈어요. 잠시 후 다시 시도하세요."
                    : "서버에 연결하지 못했어요. (" + www.error + ")";
                AddSystem(reason);
                waiting = false;
                yield break;
            }

            ChatResponse res = JsonUtility.FromJson<ChatResponse>(www.downloadHandler.text);
            if (res != null && res.reason == "no_roster" && !retried)
            {
                needRestore = true;   // 서버가 AI 명단을 잃어버렸어요 -> 아래에서 복구하고 한 번 다시 보냄
            }
            else if (res != null && res.reason == "ai_error")
            {
                AddSystem("AI 호출에 실패했어요. 서버 창의 오류를 확인해 주세요. (API 키·크레딧·모델 이름)");
            }
            else if (res == null || res.replies == null || res.replies.Length == 0)
            {
                AddSystem("(아무도 대답하지 않았어요. 잠시 후 다시 말해 보세요.)");
            }
            else
            {
                // 서버가 알려준 delay만큼 기다렸다가 하나씩 표시 (사람이 타이핑하는 것처럼)
                foreach (var r in res.replies)
                {
                    yield return new WaitForSeconds(r.delay / 1000f);
                    AddMessage(r.sender, r.text);
                }
            }
        }

        if (needRestore)
        {
            AddSystem("서버가 AI 정보를 잃어버려서 다시 연결하는 중이에요...");
            yield return server.RestoreRoster();
            yield return SendToServer(text, true);   // 같은 말을 한 번만 다시 보냄
            yield break;
        }

        waiting = false;
    }

    public void AddMessage(string sender, string text)
    {
        // 메시지 안의 < 가 TextMeshPro 태그로 해석되어 화면이 깨지지 않게 바꿔줌
        text = text.Replace("<", "\u2039");
        chatLog.text += "<b>" + sender + "</b>: " + text + "\n";
        StartCoroutine(ScrollToBottom());
    }

    void AddSystem(string text)
    {
        chatLog.text += "<color=#999999>" + text + "</color>\n";
        StartCoroutine(ScrollToBottom());
    }

    IEnumerator ScrollToBottom()
    {
        yield return null;
        Canvas.ForceUpdateCanvases();
        scrollRect.verticalNormalizedPosition = 0f;
    }
}