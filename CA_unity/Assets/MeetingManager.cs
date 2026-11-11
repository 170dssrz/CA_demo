using System.Collections;
using System.Collections.Generic;
using System.Text;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.Networking;
using UnityEngine.UI;

// 회의 소집, 회의 진행, 서버 투표 단계 전환을 관리한다.
public class MeetingManager : MonoBehaviour
{
    [Header("Python 게임 연결")]
    public GameServer gameServer;

    [Header("참가자")]
    public PlayerMove player;
    public AISpawner aiSpawner;

    [Header("모이는 장소")]
    public Transform meetingPoint;
    public float radius = 3f;
    public float gatherTime = 1f;
    public CameraFollow cameraFollow;

    [Header("회의 설정")]
    public float meetingSeconds = 90f;
    public bool chatOnlyInMeeting = true;

    [Header("UI 연결")]
    public Button meetingButton;
    public Button endButton;
    public TMP_Text timerText;
    public GameObject[] chatObjects;

    public bool IsMeeting { get; private set; }
    public bool IsVoting { get; private set; }

    private bool isMeetingStarting;
    private bool isVotingStarting;

    [System.Serializable]
    private class MeetingStartRequest
    {
        public string roomId;
        public string callerId;
        public string reason;
    }

    [System.Serializable]
    private class VotingStartRequest
    {
        public string roomId;
    }

    private IEnumerator Start()
    {
        yield return null; // ChatUI의 Start가 먼저 실행될 시간을 준다.

        if (meetingButton != null)
            meetingButton.onClick.AddListener(StartMeeting);
        else
            Debug.LogError("[Meeting] meetingButton이 연결되지 않았습니다.");

        if (endButton != null)
        {
            endButton.onClick.AddListener(EndMeeting);
            endButton.gameObject.SetActive(false);
        }

        if (timerText != null) timerText.text = "";
        SetChatVisible(!chatOnlyInMeeting);
    }

    public void StartMeeting()
    {
        if (IsMeeting || IsVoting || isMeetingStarting || isVotingStarting)
            return;

        StartCoroutine(StartMeetingWithServer());
    }

    private IEnumerator StartMeetingWithServer()
    {
        isMeetingStarting = true;
        if (meetingButton != null) meetingButton.interactable = false;

        if (gameServer == null)
        {
            Debug.LogError("[Meeting] GameServer가 연결되지 않았습니다.");
            isMeetingStarting = false;
            if (meetingButton != null) meetingButton.interactable = true;
            yield break;
        }

        var request = new MeetingStartRequest
        {
            roomId = gameServer.roomId,
            callerId = "human_0",
            reason = "emergency"
        };

        bool success = false;
        string json = JsonUtility.ToJson(request);

        using (var www = new UnityWebRequest(gameServer.Url("/api/game/meeting/start"), "POST"))
        {
            www.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
            www.downloadHandler = new DownloadHandlerBuffer();
            www.SetRequestHeader("Content-Type", "application/json");
            www.timeout = 90;

            yield return www.SendWebRequest();

            if (www.result == UnityWebRequest.Result.Success)
            {
                success = true;
                Debug.Log("[Meeting] Python 회의 시작 성공: " + www.downloadHandler.text);
            }
            else
            {
                Debug.LogError("[Meeting] Python 회의 시작 실패: " +
                    www.error + " / " + www.downloadHandler.text);
            }
        }

        isMeetingStarting = false;
        if (meetingButton != null) meetingButton.interactable = true;

        if (success)
            StartCoroutine(MeetingRoutine());
    }

    private IEnumerator MeetingRoutine()
    {
        IsMeeting = true;
        if (meetingButton != null) meetingButton.gameObject.SetActive(false);
        SetMovement(false);

        if (cameraFollow != null)
        {
            cameraFollow.enabled = false;
            Vector3 p = meetingPoint != null ? meetingPoint.position : Vector3.zero;
            cameraFollow.transform.position = new Vector3(p.x, p.y, -10f);
        }

        var members = new List<Transform>();
        if (player != null) members.Add(player.transform);
        if (aiSpawner != null)
        {
            foreach (var ai in aiSpawner.SpawnedAI)
                if (ai != null) members.Add(ai.transform);
        }
        else
            Debug.LogError("[Meeting] AISpawner가 연결되지 않았습니다.");

        Vector3 center = meetingPoint != null ? meetingPoint.position : Vector3.zero;
        var starts = new Vector3[members.Count];
        var seats = new Vector3[members.Count];

        for (int i = 0; i < members.Count; i++)
        {
            starts[i] = members[i].position;
            float angle = i * Mathf.PI * 2f / members.Count;
            seats[i] = center + new Vector3(Mathf.Cos(angle), Mathf.Sin(angle), 0f) * radius;
            seats[i].z = members[i].position.z;
        }

        float t = 0f;
        while (t < gatherTime && IsMeeting)
        {
            t += Time.deltaTime;
            float k = Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(t / Mathf.Max(gatherTime, 0.001f)));
            for (int i = 0; i < members.Count; i++)
                if (members[i] != null)
                    members[i].position = Vector3.Lerp(starts[i], seats[i], k);
            yield return null;
        }

        if (!IsMeeting) yield break;

        SetChatVisible(true);
        if (endButton != null) endButton.gameObject.SetActive(true);

        float remain = meetingSeconds;
        while (remain > 0f && IsMeeting && !isVotingStarting)
        {
            remain -= Time.deltaTime;
            if (timerText != null)
                timerText.text = "회의 " + Mathf.CeilToInt(Mathf.Max(remain, 0f)) + "초";
            yield return null;
        }

        if (IsMeeting && !isVotingStarting)
            EndMeeting();
    }

    public void EndMeeting()
    {
        if (!IsMeeting || isVotingStarting || IsVoting)
            return;

        StartCoroutine(StartVotingRoutine());
    }

    private IEnumerator StartVotingRoutine()
    {
        isVotingStarting = true;
        if (endButton != null) endButton.interactable = false;

        if (gameServer == null)
        {
            Debug.LogError("[Voting] GameServer가 연결되지 않았습니다.");
            isVotingStarting = false;
            if (endButton != null) endButton.interactable = true;
            yield break;
        }

        string json = JsonUtility.ToJson(new VotingStartRequest
        {
            roomId = gameServer.roomId
        });

        bool success = false;
        using (var www = new UnityWebRequest(gameServer.Url("/api/game/voting/start"), "POST"))
        {
            www.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
            www.downloadHandler = new DownloadHandlerBuffer();
            www.SetRequestHeader("Content-Type", "application/json");
            www.timeout = 90;

            yield return www.SendWebRequest();

            if (www.result == UnityWebRequest.Result.Success)
            {
                success = true;
                Debug.Log("[Voting] 투표 시작 성공: " + www.downloadHandler.text);
            }
            else
            {
                Debug.LogError("[Voting] 투표 시작 실패: " +
                    www.error + " / " + www.downloadHandler.text);
            }
        }

        isVotingStarting = false;
        if (!success)
        {
            if (endButton != null) endButton.interactable = true;
            yield break;
        }

        IsMeeting = false;
        IsVoting = true;
        if (timerText != null) timerText.text = "투표 진행 중";
        if (endButton != null) endButton.gameObject.SetActive(false);
        if (meetingButton != null) meetingButton.gameObject.SetActive(false);

        if (EventSystem.current != null)
            EventSystem.current.SetSelectedGameObject(null);
        ChatUI.IsTyping = false;

        SetChatVisible(false);
        SetMovement(false); // 투표 UI가 준비될 때까지 이동 제한
        Debug.Log("[Voting] Unity 투표 단계 진입 완료");
    }

    // 이후 VotingManager가 투표 집계 성공 후 호출할 수 있도록 준비한 메서드.
    // 서버의 최종 투표 처리 성공을 확인한 뒤에만 호출해야 한다.
    public void FinishVoting(bool gameFinished)
    {
        if (!IsVoting) return;

        IsVoting = false;
        if (timerText != null) timerText.text = "";

        if (gameFinished)
        {
            Debug.Log("[Voting] 게임 종료: 이동 제한 유지");
            return;
        }

        if (EventSystem.current != null)
            EventSystem.current.SetSelectedGameObject(null);
        ChatUI.IsTyping = false;

        SetChatVisible(!chatOnlyInMeeting);
        SetMovement(true);
        if (cameraFollow != null) cameraFollow.enabled = true;
        if (meetingButton != null) meetingButton.gameObject.SetActive(true);
    }

    private void SetMovement(bool on)
    {
        if (player != null) player.enabled = on;
        if (aiSpawner == null)
        {
            Debug.LogError("[Meeting] AISpawner가 연결되지 않았습니다.");
            return;
        }
        foreach (var ai in aiSpawner.SpawnedAI)
        {
            if (ai == null) continue;
            var wander = ai.GetComponent<AIWander>();
            if (wander != null) wander.enabled = on;
        }
    }

    private void SetChatVisible(bool visible)
    {
        if (chatObjects == null) return;
        foreach (var go in chatObjects)
            if (go != null) go.SetActive(visible);
    }
}
