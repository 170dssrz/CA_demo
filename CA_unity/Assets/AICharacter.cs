
using TMPro;
using UnityEngine;

public class AICharacter : MonoBehaviour
{
    public string playerId;
    public string displayName;
    public TMP_Text nameLabel;

    public void Setup(string name, Sprite sprite)
    {
        SetupName(name);

        // 기존 Sprite 캐릭터 지원
        SpriteRenderer sr = GetComponent<SpriteRenderer>();

        if (sr != null && sprite != null)
        {
            sr.sprite = sprite;
        }
    }

    // SPUM 캐릭터용 초기화
    public void SetupSPUM(string name)
    {
        SetupName(name);
    }

    private void SetupName(string name)
    {
        displayName = name;
        gameObject.name = name;

        if (nameLabel != null)
        {
            nameLabel.text = name;
        }
    }

    public void SetPlayerId(string id)
    {
        playerId = id;
        Debug.Log(
            $"[AICharacter] {displayName} / ID: {playerId}"
        );
    }
}
