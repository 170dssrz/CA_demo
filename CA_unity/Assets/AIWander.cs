using UnityEngine;

// AI 프리팹에 붙이는 스크립트: 맵 안을 돌아다니다가 가끔 멈춤
public class AIWander : MonoBehaviour
{
    public float speed = 2.5f;
    public SpriteRenderer background;    // AISpawner가 생성할 때 채워줌 (프리팹에서는 비워 두기)
    public float padding = 0.5f;         // 가장자리에서 안쪽으로 띄울 거리
    public float waitMin = 1f;           // 도착 후 최소 대기 시간
    public float waitMax = 3f;           // 도착 후 최대 대기 시간
    public bool spriteFacesRight = true; // 원본 이미지가 오른쪽을 보고 있으면 체크

    SpriteRenderer sr;
    Vector3 target;
    float waitTimer;

    void Awake()
    {
        sr = GetComponent<SpriteRenderer>();
    }

    void Start()
    {
        PickTarget();
    }

    void PickTarget()
    {
        if (background == null)
        {
            target = transform.position;
            return;
        }

        Bounds b = background.bounds;
        target = new Vector3(
            Random.Range(b.min.x + padding, b.max.x - padding),
            Random.Range(b.min.y + padding, b.max.y - padding),
            transform.position.z);
    }

    void Update()
    {
        // 도착해서 쉬는 중이면 대기
        if (waitTimer > 0f)
        {
            waitTimer -= Time.deltaTime;
            return;
        }

        Vector3 dir = target - transform.position;

        // 목적지에 도착하면 잠깐 멈췄다가 새 목적지 선택
        if (dir.magnitude < 0.1f)
        {
            waitTimer = Random.Range(waitMin, waitMax);
            PickTarget();
            return;
        }

        // 좌우 방향에 맞춰 이미지 반전
        if (sr != null && Mathf.Abs(dir.x) > 0.01f)
        {
            bool goingLeft = dir.x < 0;
            sr.flipX = spriteFacesRight ? goingLeft : !goingLeft;
        }

        transform.position += dir.normalized * speed * Time.deltaTime;
    }
}
