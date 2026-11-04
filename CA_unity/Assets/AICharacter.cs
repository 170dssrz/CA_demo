using TMPro;
using UnityEngine;

// AI 프리팹에 붙이는 스크립트: 생성될 때 이름과 이미지를 받아서 적용
public class AICharacter : MonoBehaviour
{
    public string displayName;
    public TMP_Text nameLabel;   // (선택) 캐릭터 머리 위 이름표. 자식 오브젝트로 만들어 연결

    public void Setup(string name, Sprite sprite)
    {
        displayName = name;
        gameObject.name = name;
        GetComponent<SpriteRenderer>().sprite = sprite;
        if (nameLabel != null) nameLabel.text = name;
    }
}
