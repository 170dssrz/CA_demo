using System;
using System.Collections;
using System.Collections.Generic;
using System.Text;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.Networking;

// 후보 선택과 사람 플레이어 투표 제출을 담당한다.
public class VotingManager : MonoBehaviour
{
    [Header("기존 컴포넌트")]
    public MeetingManager meetingManager;
    public GameServer gameServer;
    public AISpawner aiSpawner;

    [Header("투표 UI")]
    public GameObject votingPanel;
    public RectTransform candidateContainer;
    public Button voteButton;
    public TMP_Text statusText;

    [Serializable]
    private class VoteRequest
    {
        public string roomId;
        public string voterId;
        public string targetId;
    }

    private bool submitting;
    private bool submitted;
    private bool panelShown;
    private string selectedPlayerId;
    private readonly List<GameObject> candidateButtons = new List<GameObject>();

    private void Start()
    {
        if (votingPanel != null) votingPanel.SetActive(false);
        if (voteButton != null)
        {
            voteButton.interactable = false;
            voteButton.onClick.AddListener(OnVoteButtonClicked);
        }
    }

    private void Update()
    {
        if (meetingManager == null) return;
        if (meetingManager.IsVoting && !panelShown)
            ShowVotingPanel();
        else if (!meetingManager.IsVoting && panelShown)
            HideVotingPanel();
    }

    private void ShowVotingPanel()
    {
        if (votingPanel == null || candidateContainer == null || aiSpawner == null)
        {
            Debug.LogError("[VotingUI] VotingPanel, CandidateContainer, AISpawner 연결을 확인하세요.");
            return;
        }

        panelShown = true;
        selectedPlayerId = null;
        submitting = false;
        submitted = false;
        if (voteButton != null) voteButton.interactable = false;
        if (statusText != null) statusText.text = "투표할 플레이어를 선택하세요.";
        ClearCandidates();

        // 사람 플레이어는 AI 프리팹이 아니므로 따로 추가한다.
        string humanName = gameServer != null ? gameServer.myName : "나";
        CreateCandidate("human_0", humanName);

        foreach (var ai in aiSpawner.SpawnedAI)
        {
            if (ai == null || string.IsNullOrEmpty(ai.playerId)) continue;
            CreateCandidate(ai.playerId, ai.displayName);
        }

        votingPanel.SetActive(true);
        Debug.Log("[VotingUI] 후보 목록 표시 완료: " + candidateButtons.Count + "명");
    }

    private void CreateCandidate(string playerId, string displayName)
    {
        // 별도 프리팹 없이 기본 Unity UI 버튼을 동적으로 생성한다.
        var buttonObject = new GameObject("Candidate_" + playerId,
            typeof(RectTransform), typeof(Image), typeof(Button), typeof(LayoutElement));
        buttonObject.transform.SetParent(candidateContainer, false);

        var layout = buttonObject.GetComponent<LayoutElement>();
        layout.preferredHeight = 42f;
        layout.minHeight = 42f;

        var image = buttonObject.GetComponent<Image>();
        image.color = new Color(0.85f, 0.85f, 0.85f, 1f);
        var button = buttonObject.GetComponent<Button>();
        button.targetGraphic = image;

        var labelObject = new GameObject("Label", typeof(RectTransform), typeof(TextMeshProUGUI));
        labelObject.transform.SetParent(buttonObject.transform, false);
        var labelRect = labelObject.GetComponent<RectTransform>();
        labelRect.anchorMin = Vector2.zero;
        labelRect.anchorMax = Vector2.one;
        labelRect.offsetMin = Vector2.zero;
        labelRect.offsetMax = Vector2.zero;
        var label = labelObject.GetComponent<TextMeshProUGUI>();
        if (statusText != null && statusText.font != null) label.font = statusText.font;
        label.text = displayName;
        label.fontSize = 22;
        label.color = Color.black;
        label.alignment = TextAlignmentOptions.Center;
        label.raycastTarget = false;

        button.onClick.AddListener(() => SelectCandidate(playerId, displayName));
        candidateButtons.Add(buttonObject);
    }

    private void SelectCandidate(string playerId, string displayName)
    {
        if (submitting || submitted) return;
        selectedPlayerId = playerId;
        if (statusText != null) statusText.text = "선택: " + displayName;
        if (voteButton != null) voteButton.interactable = true;
        Debug.Log("[VotingUI] 후보 선택: " + playerId);
    }

    private void OnVoteButtonClicked()
    {
        if (submitting || submitted || string.IsNullOrEmpty(selectedPlayerId)) return;
        if (gameServer == null)
        {
            Debug.LogError("[VotingUI] GameServer가 연결되지 않았습니다.");
            if (statusText != null) statusText.text = "GameServer 연결을 확인하세요.";
            return;
        }
        StartCoroutine(SubmitVote(selectedPlayerId));
    }

    private IEnumerator SubmitVote(string targetId)
    {
        submitting = true;
        if (voteButton != null) voteButton.interactable = false;
        if (statusText != null) statusText.text = "투표를 서버에 전송하는 중...";

        var request = new VoteRequest
        {
            roomId = gameServer.roomId,
            voterId = "human_0",
            targetId = targetId
        };
        byte[] json = Encoding.UTF8.GetBytes(JsonUtility.ToJson(request));

        using (var www = new UnityWebRequest(gameServer.Url("/api/game/vote"), "POST"))
        {
            www.uploadHandler = new UploadHandlerRaw(json);
            www.downloadHandler = new DownloadHandlerBuffer();
            www.SetRequestHeader("Content-Type", "application/json");
            www.timeout = 30;
            yield return www.SendWebRequest();

            bool transportOk = www.result == UnityWebRequest.Result.Success;
            string response = www.downloadHandler != null ? www.downloadHandler.text : "";
            // Node API는 { ok: true }를 반환해야 성공으로 처리한다.
            bool apiOk = false;
            if (transportOk)
            {
                try
                {
                    VoteResponse parsed = JsonUtility.FromJson<VoteResponse>(response);
                    apiOk = parsed != null && parsed.ok;
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[VotingUI] 투표 응답 JSON 분석 실패: " + ex.Message);
                }
            }

            if (transportOk && apiOk)
            {
                submitted = true;
                if (statusText != null) statusText.text = "투표 완료! 다른 플레이어의 투표를 기다리는 중...";
                Debug.Log("[VotingUI] 서버 투표 제출 성공: human_0 → " + targetId);
            }
            else
            {
                if (statusText != null) statusText.text = "투표 실패. 다시 시도해 주세요.";
                Debug.LogError("[VotingUI] 투표 제출 실패: HTTP " + www.responseCode +
                               " / " + www.error + " / " + response);
                if (voteButton != null) voteButton.interactable = true;
            }
        }
        submitting = false;
    }

    [Serializable]
    private class VoteResponse
    {
        public bool ok;
    }

    private void HideVotingPanel()
    {
        panelShown = false;
        if (votingPanel != null) votingPanel.SetActive(false);
        ClearCandidates();
    }

    private void ClearCandidates()
    {
        foreach (var button in candidateButtons)
            if (button != null) Destroy(button);
        candidateButtons.Clear();
    }
}
