using UnityEngine;
using UnityEngine.Tilemaps;

// Main Camera에 붙이는 스크립트: 플레이어를 따라가되 RAF 맵의 경계 안으로 카메라를 제한
public class CameraFollow : MonoBehaviour
{
    public Transform target;              // human_0
    public SpriteRenderer background;     // 기존 배경 (호환성 유지, RAF Tilemap이 없을 때만 사용)
    public Tilemap mapBoundsTilemap;       // RAF_background > Grid > Floor

    private Camera cam;

    void Awake()
    {
        cam = GetComponent<Camera>();
    }

    void LateUpdate()
    {
        if (target == null) return;

        float x = target.position.x;
        float y = target.position.y;

        Bounds bounds;
        bool hasBounds = false;

        if (mapBoundsTilemap != null)
        {
            // Tilemap의 셀 범위를 월드 좌표로 변환한다.
            // RAF의 일반적인 축 정렬 Rectangular Tilemap 기준.
            BoundsInt cells = mapBoundsTilemap.cellBounds;
            if (cells.size.x > 0 && cells.size.y > 0)
            {
                Vector3 a = mapBoundsTilemap.CellToWorld(cells.min);
                Vector3 b = mapBoundsTilemap.CellToWorld(cells.max);
                Vector3 min = Vector3.Min(a, b);
                Vector3 max = Vector3.Max(a, b);
                bounds = new Bounds((min + max) * 0.5f, max - min);
                hasBounds = true;
            }
            else
            {
                bounds = default(Bounds);
            }
        }
        else
        {
            bounds = default(Bounds);
        }

        if (!hasBounds && background != null)
        {
            bounds = background.bounds;
            hasBounds = true;
        }

        if (hasBounds && cam != null && cam.orthographic)
        {
            float halfH = cam.orthographicSize;
            float halfW = halfH * cam.aspect;

            float minX = bounds.min.x + halfW;
            float maxX = bounds.max.x - halfW;
            float minY = bounds.min.y + halfH;
            float maxY = bounds.max.y - halfH;

            x = minX > maxX ? bounds.center.x : Mathf.Clamp(x, minX, maxX);
            y = minY > maxY ? bounds.center.y : Mathf.Clamp(y, minY, maxY);
        }

        // 기존 카메라 Z값을 유지한다.
        transform.position = new Vector3(x, y, transform.position.z);
    }
}
