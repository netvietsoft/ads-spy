# Aff Library: tự điền Traffic/Bounce/Time khi quét (AITDK)

Ngày: 2026-08-03 · Trạng thái: **đã làm xong** (11 phép kiểm BE với AITDK thật + 7 phép kiểm UI)

## Vấn đề

3 cột Traffic/th · Bounce · Time trong Aff Library lấy từ bảng `aff_domain_traffic` qua JOIN, nhưng bảng
đó chỉ được ghi khi người dùng **dán tay** khối text AITDK qua nút 📊 từng dòng. Kho 5.648 dòng (prod) /
9.7k (local) gần như trống 3 cột này.

## Cái đã có sẵn (không phải làm lại)

`TrafficService` (WIP chưa commit của chủ dự án) đã gọi API AITDK `wapi.aitdk.com` ký HMAC-SHA256 bằng
`AITDK_SECRET_KEY`, **từ server, không cần extension/userscript**: proxy xoay + circuit breaker, batch 50
domain/lần, parse SSE, và `save=true` **đã upsert thẳng vào `aff_domain_traffic`** — đúng bảng UI JOIN.

Đo thật: 4 domain / **955ms** cho 1 lần gọi; 5.648 domain ≈ 113 lần gọi ≈ 2–4 phút.

Nên việc cần làm chỉ là **gọi nó lúc quét** + một nút điền bù cho kho cũ.

## Điều kiện tiên quyết

- Commit `apps/api/src/traffic/` (3 file BE) + 6 dòng đăng ký trong `app.module.ts`. KHÔNG kéo theo
  `traffictool/` FE hay `TrafficPanel.tsx` (chưa cần cho việc này) — chúng vẫn là WIP local.
- `ecosystem.config.js` truyền `AITDK_SECRET_KEY` + `AITDK_PROXY_FILE` từ env (KHÔNG hardcode — repo public).
  Thiếu key → API trả 503 "Chưa cấu hình SECRET_KEY", **việc quét affiliate vẫn chạy bình thường**.

## Thiết kế

### Cột mới `traffic_tried_at BIGINT`

Bắt buộc phải có cột riêng: domain mà AITDK **không có dữ liệu** sẽ không bao giờ có dòng trong
`aff_domain_traffic`, nên nếu hàng đợi chỉ dựa vào `LEFT JOIN ... IS NULL` thì lô đầu tắc mãi và cả kho
không bao giờ điền xong. Đánh dấu **cả lô** đã thử (kể cả lô lỗi) → hàng đợi luôn cạn.

### Hàng đợi

```sql
FROM aff_library al LEFT JOIN aff_domain_traffic t ON t.web = al.web COLLATE utf8mb4_unicode_ci
WHERE t.web IS NULL AND al.traffic_tried_at IS NULL AND (al.dns_ok IS NULL OR al.dns_ok = 1)
```

Bỏ domain `dns_ok = 0` — chúng sắp bị xoá ở danh sách "cần dọn", không tốn quota AITDK.

### Tự điền ở 3 chỗ

| Chỗ | Cách gọi |
|---|---|
| `scan()` — dán domain mới | điền ngay cho các domain DNS còn sống |
| `detectOne()` — nút ⟳ 1 dòng | điền cho đúng domain đó sau khi quét xong |
| Job nền | callback `onBatch` sau mỗi lô, chia thành chùm 50 domain/lần gọi |

**Cả 3 đều bọc `catch`**: traffic là dữ liệu bổ sung, AITDK lỗi/hết quota **không được làm gãy việc quét**.
Job nền dùng callback để `AffLibDetect` không phải biết tới `TrafficService`.

### Điền bù kho cũ

`POST /aff-lib/traffic-fill` → 1 lô 50, trả `{ filled, remaining, error? }`. FE nút **📊 Điền traffic
thiếu** gọi lặp; dừng khi hết, khi `error` (hiện lý do), hoặc khi `remaining` không giảm.

## Không làm (YAGNI)

Không ghép UI `traffictool/` vào trang này · không tự xoá gì · không đổi 3 cột hiện có (chỉ làm tròn
Bounce, xem dưới).

## Hai lỗi phát hiện khi test, đã sửa

1. **`Bounce` hiện `34.582972737668484%`** — dữ liệu dán tay trước đây đã tròn sẵn, còn API AITDK trả full
   precision. Thêm hàm `bounce()` làm tròn 1 số → `34.6%`.
2. **`detectOne` không bọc catch quanh phần điền traffic** → AITDK thiếu key làm nút ⟳ trả 503 dù việc quét
   affiliate đã thành công và đã lưu. Test UI bắt được qua lỗi console 503.

## Nghiệm thu

- BE với AITDK thật: 2 domain thật có `visits`/`bounce_rate`/`visit_duration_sec`; cả lô được đánh
  `traffic_tried_at` kể cả domain không có dữ liệu; hàng đợi cạn được; thiếu key → `fillTraffic` trả
  `error` chứ không throw; `listRows` JOIN trả đủ 3 số cho UI.
- UI: nút có mặt; 3 cột hiện `955,415` / `34.6%` / `1:34`; bấm nút khi thiếu key → gọi 1 lần rồi dừng và
  hiện đúng lý do; không lỗi JS.
