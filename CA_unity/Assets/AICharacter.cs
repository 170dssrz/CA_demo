
using TMPro;
using UnityEngine;

// AI 프리팹에 붙이는 스크립트
public class AICharacter : MonoBehaviour
{
    public string playerId;     // Python 게임에서 사용하는 고유 ID
    public string displayName;
    public TMP_Text nameLabel;

    public void Setup(string name, Sprite sprite)
    {
        displayName = name;
        gameObject.name = name;
        GetComponent<SpriteRenderer>().sprite = sprite;

        if (nameLabel != null)
            nameLabel.text = name;
    }

    // Python의 playerId 저장
    public void SetPlayerId(string id)
    {
        playerId = id;
        Debug.Log($"[AICharacter] {displayName} / ID: {playerId}");
    }
}
