using UnityEngine;

// Main Camera에 붙이는 스크립트: 캐릭터를 따라가되 맵 밖의 빈 공간은 비추지 않음
public class CameraFollow : MonoBehaviour
{
    public Transform target;            // human_0
    public SpriteRenderer background;   // background_0
    Camera cam;

    void Start()
    {
        cam = GetComponent<Camera>();
    }

    void LateUpdate()
    {
        if (target == null) return;

        float x = target.position.x;
        float y = target.position.y;

        if (background != null)
        {
            Bounds b = background.bounds;
            float halfH = cam.orthographicSize;
            float halfW = halfH * cam.aspect;

            float minX = b.min.x + halfW, maxX = b.max.x - halfW;
            float minY = b.min.y + halfH, maxY = b.max.y - halfH;

            // 맵이 화면보다 작으면 중앙에 고정, 아니면 가장자리 밖이 안 보이게 제한
            x = minX > maxX ? b.center.x : Mathf.Clamp(x, minX, maxX);
            y = minY > maxY ? b.center.y : Mathf.Clamp(y, minY, maxY);
        }

        transform.position = new Vector3(x, y, -10f);
    }
}
