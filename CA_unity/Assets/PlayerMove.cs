
using UnityEngine;
using UnityEngine.InputSystem;

// 플레이어 캐릭터(human_0)에 붙이는 이동 스크립트
public class PlayerMove : MonoBehaviour
{
    public float speed = 5f;
    public SpriteRenderer background;
    public float padding = 0.5f;
    public bool spriteFacesRight = true;

    private SpriteRenderer sr;
    private Rigidbody2D rb;
    private Vector2 move;

    void Awake()
    {
        sr = GetComponent<SpriteRenderer>();
        rb = GetComponent<Rigidbody2D>();
    }

    void Update()
    {
        move = Vector2.zero;

        // 채팅 중에는 이동 금지
        if (ChatUI.IsTyping) return;

        var kb = Keyboard.current;
        if (kb == null) return;

        if (kb.wKey.isPressed || kb.upArrowKey.isPressed)
            move.y += 1;

        if (kb.sKey.isPressed || kb.downArrowKey.isPressed)
            move.y -= 1;

        if (kb.aKey.isPressed || kb.leftArrowKey.isPressed)
            move.x -= 1;

        if (kb.dKey.isPressed || kb.rightArrowKey.isPressed)
            move.x += 1;

        move = move.normalized;

        // 기존 Sprite 좌우 반전 유지
        if (sr != null && move.x != 0)
        {
            bool goingLeft = move.x < 0;
            sr.flipX = spriteFacesRight
                ? goingLeft
                : !goingLeft;
        }
    }

    void FixedUpdate()
    {
        if (rb == null) return;

        Vector2 pos =
            rb.position + move * speed * Time.fixedDeltaTime;

        // 기존 배경 범위 제한 유지
        if (background != null)
        {
            Bounds b = background.bounds;

            pos.x = Mathf.Clamp(
                pos.x,
                b.min.x + padding,
                b.max.x - padding
            );

            pos.y = Mathf.Clamp(
                pos.y,
                b.min.y + padding,
                b.max.y - padding
            );
        }

        rb.MovePosition(pos);
    }
}
