using UnityEngine;
using UnityEngine.InputSystem;

// 플레이어 캐릭터(human_0)에 붙이는 이동 스크립트 (새 Input System 기준)
public class PlayerMove : MonoBehaviour
{
    public float speed = 5f;
    public SpriteRenderer background;    // background_0 연결 (맵 밖으로 못 나가게)
    public float padding = 0.5f;
    public bool spriteFacesRight = true; // 원본 이미지가 오른쪽을 보고 있으면 체크

    SpriteRenderer sr;

    void Awake()
    {
        sr = GetComponent<SpriteRenderer>();
    }

    void Update()
    {
        if (ChatUI.IsTyping) return;   // 채팅 입력 중엔 이동 금지

        var kb = Keyboard.current;
        if (kb == null) return;

        Vector2 move = Vector2.zero;
        if (kb.wKey.isPressed || kb.upArrowKey.isPressed) move.y += 1;
        if (kb.sKey.isPressed || kb.downArrowKey.isPressed) move.y -= 1;
        if (kb.aKey.isPressed || kb.leftArrowKey.isPressed) move.x -= 1;
        if (kb.dKey.isPressed || kb.rightArrowKey.isPressed) move.x += 1;

        // 좌우 입력이 있을 때만 방향을 바꿈 (위아래만 움직일 땐 유지)
        if (sr != null && move.x != 0)
        {
            bool goingLeft = move.x < 0;
            sr.flipX = spriteFacesRight ? goingLeft : !goingLeft;
        }

        Vector3 pos = transform.position + (Vector3)(move.normalized * speed * Time.deltaTime);

        if (background != null)
        {
            Bounds b = background.bounds;
            pos.x = Mathf.Clamp(pos.x, b.min.x + padding, b.max.x - padding);
            pos.y = Mathf.Clamp(pos.y, b.min.y + padding, b.max.y - padding);
        }
        transform.position = pos;
    }
}
