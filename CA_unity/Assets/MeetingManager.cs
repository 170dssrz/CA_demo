using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

// 어몽어스식 "회의 소집" 기능.
// 버튼을 누르면 모두(플레이어 + AI)가 한자리에 모이고 채팅창이 열려요.
// 정해진 시간이 지나거나 "회의 종료" 버튼을 누르면 다시 흩어져요.
public class MeetingManager : MonoBehaviour
{
    [Header("참가자")]
    public PlayerMove player;              // 플레이어 캐릭터(human_0)

    [Header("모이는 장소")]
    public Transform meetingPoint;         // 빈 오브젝트를 하나 만들어 맵 가운데 쯤에 두세요 (비우면 (0,0))
    public float radius = 3f;              // 모였을 때 둥글게 앉는 반지름
    public float gatherTime = 1f;          // 모이는 데 걸리는 시간(초)
    public CameraFollow cameraFollow;      // Main Camera에 붙은 CameraFollow (연결하면 회의 중 카메라가 모이는 장소를 정중앙에 비춰요)

    [Header("회의 설정")]
    public float meetingSeconds = 90f;     // 회의 시간(초)
    public bool chatOnlyInMeeting = true;  // 켜면 회의 중에만 채팅창이 보임

    [Header("UI 연결")]
    public Button meetingButton;           // "회의 소집" 버튼
    public Button endButton;               // "회의 종료" 버튼 (회의 중에만 보임)
    public TMP_Text timerText;             // 남은 시간 표시 (선택)
    public GameObject[] chatObjects;       // 회의 중에만 보일 채팅 UI (Scroll View, Input Field)

    public bool IsMeeting { get; private set; }

    IEnumerator Start()
    {
        yield return null;   // ChatUI의 Start가 먼저 끝나도록 한 프레임 기다림

        meetingButton.onClick.AddListener(StartMeeting);
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
        if (IsMeeting) return;
        StartCoroutine(MeetingRoutine());
    }

    IEnumerator MeetingRoutine()
    {
        IsMeeting = true;
        meetingButton.gameObject.SetActive(false);
        SetMovement(false);   // 모이는 동안 이동 중지
        if (cameraFollow != null)
        {
            // 회의 동안 카메라가 플레이어를 따라가지 않게 끄고, 모이는 장소를 화면 정중앙에 놓는다
            cameraFollow.enabled = false;
            Vector3 p = meetingPoint != null ? meetingPoint.position : Vector3.zero;
            cameraFollow.transform.position = new Vector3(p.x, p.y, -10f);
        }

        // 모일 사람들: 플레이어 + 지금 있는 모든 AI
        var members = new List<Transform>();
        if (player != null) members.Add(player.transform);
        foreach (var ai in FindObjectsByType<AICharacter>())
            members.Add(ai.transform);

        // 둥글게 앉을 자리 계산
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

        // 부드럽게 모이기
        float t = 0f;
        while (t < gatherTime)
        {
            t += Time.deltaTime;
            float k = Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(t / gatherTime));
            for (int i = 0; i < members.Count; i++)
                if (members[i] != null) members[i].position = Vector3.Lerp(starts[i], seats[i], k);
            yield return null;
        }

        // 다 모였으면 채팅창 열기
        SetChatVisible(true);
        if (endButton != null) endButton.gameObject.SetActive(true);

        // 회의 시간 카운트다운
        float remain = meetingSeconds;
        while (remain > 0f && IsMeeting)
        {
            remain -= Time.deltaTime;
            if (timerText != null)
                timerText.text = "회의 " + Mathf.CeilToInt(Mathf.Max(remain, 0f)) + "초";
            yield return null;
        }

        EndMeeting();   // 시간이 다 됐을 때 (버튼으로 이미 끝났다면 아무 일도 안 함)
    }

    public void EndMeeting()
    {
        if (!IsMeeting) return;
        IsMeeting = false;

        if (timerText != null) timerText.text = "";
        if (endButton != null) endButton.gameObject.SetActive(false);
        meetingButton.gameObject.SetActive(true);

        // 입력창에 커서가 남아 있으면 다시 움직일 수 없으니 해제
        if (EventSystem.current != null) EventSystem.current.SetSelectedGameObject(null);
        ChatUI.IsTyping = false;

        SetChatVisible(!chatOnlyInMeeting);
        SetMovement(true);   // 다시 흩어져서 움직이기
        if (cameraFollow != null) cameraFollow.enabled = true;   // 카메라가 다시 플레이어를 따라감
    }

    // 플레이어와 AI의 이동 스크립트를 켜거나 끔
    void SetMovement(bool on)
    {
        if (player != null) player.enabled = on;
        foreach (var ai in FindObjectsByType<AICharacter>())
        {
            var wander = ai.GetComponent<AIWander>();
            if (wander != null) wander.enabled = on;
        }
    }

    void SetChatVisible(bool visible)
    {
        if (chatObjects == null) return;
        foreach (var go in chatObjects)
            if (go != null) go.SetActive(visible);
    }
}