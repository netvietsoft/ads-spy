# 06 — Web UI (Next.js)

> Dựa trên `apps/web/app/*`. Cập nhật: 2026-07-02.

═══════════════════════════════════════════════════════════════════════
## 1. TỔNG QUAN
═══════════════════════════════════════════════════════════════════════

Next.js app router, cổng **3101**. Một trang chính (`page.tsx`) giữ toàn bộ state tra cứu
(client component), 1 component tách riêng cho modal chi tiết. CSS thuần token-hóa trong
`globals.css` (không framework UI). Giao diện dark, kiểu "ad-intelligence console".

```
app/
├─ layout.tsx      <html lang="vi"> + globals.css + <title> Google Ads Spy
├─ globals.css     biến màu + class .searchbar/.stat/.panel/.adv/.card/.badge/.modal…
├─ page.tsx        SEARCH + STATS + FILTER NQC + GRID CREATIVE + HISTORY
├─ api.ts          gọi backend (fetch) + assetProxy()
└─ components/CreativeModal.tsx   chi tiết 1 creative + tải asset
```

═══════════════════════════════════════════════════════════════════════
## 2. LUỒNG TƯƠNG TÁC
═══════════════════════════════════════════════════════════════════════

```
[ô nhập domain] --submit--> api.search(domain)
     │  loading spinner trên nút "Tra cứu"
     ▼
setData(res)
     ├─ 3 thẻ STATS: số nhà quảng cáo · số creative · tổng ads ước tính
     ├─ cột trái: danh sách NHÀ QUẢNG CÁO (nút "Tất cả" + từng advertiser, có badge số creative)
     │       click → setActiveAdv(id) → lọc grid theo advertiserId (useMemo)
     └─ cột phải: GRID CREATIVE (ảnh qua /api/asset; embed hiện nhãn "Embed/HTML")
              click card → setSelected(creative) → <CreativeModal>
                   gọi api.getCreative → hiện variants (ảnh/nút mở) + vùng + ngày + nút "↓ Tải"
[LỊCH SỬ] api.getHistory() → click 1 dòng để tra lại domain đó
```

- Lỗi (vd 503 bị chặn): `api.ts::jsonOrThrow` bóc `message` từ body → hiện khối `.error` đỏ
  với đúng câu tiếng Việt từ backend.
- Ảnh dùng `assetProxy(url)` = `/api/asset?url=<enc>`; tải = `assetProxy(url, true)` (`&download=1`).

═══════════════════════════════════════════════════════════════════════
## 3. PROXY /api (next.config.js)
═══════════════════════════════════════════════════════════════════════

```js
rewrites: [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }]
// API_ORIGIN mặc định http://localhost:3100
```

Nhờ vậy web gọi **same-origin** `/api/...` (không lo CORS), và ảnh Google cũng qua backend.
Khi deploy: đặt `API_ORIGIN` trỏ tới host API thật.

═══════════════════════════════════════════════════════════════════════
## 4. DESIGN TOKENS (globals.css)
═══════════════════════════════════════════════════════════════════════

Biến chính (`:root`): `--bg`, `--panel`, `--panel-2`, `--border`, `--text`, `--muted`,
`--accent` (xanh), `--accent-2` (xanh ngọc), `--danger`, `--radius`.
Badge loại asset: `.badge.image` (xanh ngọc) · `.badge.embed` (xanh). Grid responsive
(`repeat(auto-fill, minmax(200px,1fr))`), layout 2 cột co về 1 cột khi < 860px.

Đổi giao diện → sửa biến/lớp ở đây, đừng hardcode màu trong `.tsx`.

═══════════════════════════════════════════════════════════════════════
## 5. GIỚI HẠN UI HIỆN TẠI
═══════════════════════════════════════════════════════════════════════

- Chưa có autocomplete domain (dù backend có `suggest`), chưa chọn region, chưa phân trang thêm
  ở UI (mặc định ≤5 trang từ backend).
- Embed creative chỉ hiện nút "Mở" (URL `content.js`), chưa render iframe trong app.
- State không lưu URL (không sharable link) — reload mất kết quả, phải tra lại (có Lịch sử hỗ trợ).
