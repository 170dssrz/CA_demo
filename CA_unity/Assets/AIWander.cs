using UnityEngine;

// AI 프리팹에 붙이는 스크립트: 맵 안을 돌아다니다가 가끔 멈춤
public class AIWander : MonoBehaviour
{
    public float speed = 2.5f;
    public SpriteRenderer background; // AISpawner가 생성할 때 연결
    public float padding = 0.5f;
    public float waitMin = 1f;
    public float waitMax = 3f;
    public bool spriteFacesRight = true;

    private SpriteRenderer sr;
    private Rigidbody2D rb;
    private Vector2 target;
    private float waitTimer;
    private float stuckTimer;
    private Vector2 lastPosition;

    void Awake()
    {
        sr = GetComponent<SpriteRenderer>();
        rb = GetComponent<Rigidbody2D>();
        if (rb == null)
            Debug.LogError($"AIWander: {name}에 Rigidbody2D가 없습니다.", this);
    }

    void Start()
    {
        if (rb == null) { enabled = false; return; }
        lastPosition = rb.position;
        PickTarget();
    }

    void PickTarget()
    {
        if (background == null)
        {
            target = rb.position;
            return;
        }

        Bounds b = background.bounds;
        float minX = b.min.x + padding;
        float maxX = b.max.x - padding;
        float minY = b.min.y + padding;
        float maxY = b.max.y - padding;
        if (minX >= maxX || minY >= maxY)
        {
            target = rb.position;
            return;
        }

        target = new Vector2(Random.Range(minX, maxX), Random.Range(minY, maxY));
        stuckTimer = 0f;
        lastPosition = rb.position;
    }

    void FixedUpdate()
    {
        if (waitTimer > 0f)
        {
            waitTimer -= Time.fixedDeltaTime;
            lastPosition = rb.position;
            return;
        }

        Vector2 dir = target - rb.position;
        if (dir.magnitude < 0.1f)
        {
            waitTimer = Random.Range(waitMin, waitMax);
            PickTarget();
            return;
        }

        if (sr != null && Mathf.Abs(dir.x) > 0.01f)
        {
            bool goingLeft = dir.x < 0;
            sr.flipX = spriteFacesRight ? goingLeft : !goingLeft;
        }

        // 벽에 막혀 실제 위치가 거의 변하지 않으면 새 목적지를 선택한다.
        if (Vector2.Distance(rb.position, lastPosition) < 0.005f)
            stuckTimer += Time.fixedDeltaTime;
        else
            stuckTimer = 0f;

        if (stuckTimer >= 0.7f)
        {
            PickTarget();
            waitTimer = Random.Range(waitMin, waitMax);
            return;
        }

        lastPosition = rb.position;
        Vector2 step = dir.normalized * speed * Time.fixedDeltaTime;
        rb.MovePosition(rb.position + Vector2.ClampMagnitude(step, dir.magnitude));
    }
}
