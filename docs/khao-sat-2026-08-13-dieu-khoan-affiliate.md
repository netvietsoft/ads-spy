# Khảo sát — 2026-08-13: có lấy được ĐIỀU KHOẢN THẬT của chương trình affiliate không?

> Chạy trước khi xây Phần 2 (rút trích nội quy/luật). Mục đích: trả lời bằng **số đo thật** câu hỏi
> "có khả thi không", thay vì cam kết rồi mới biết. Mẫu ngẫu nhiên từ `aff_program` ⋈ `aff_library`
> (`aff_status='yes'`, DNS còn sống). Script khảo sát nằm ở scratchpad, không commit — cách làm ghi đủ dưới
> đây để chạy lại.

## Vì sao phải khảo sát: dữ liệu đang có KHÔNG dùng được

`aff_program.terms_text` đã lưu 10.348 dòng, nhưng đó là **trường mô tả trong API của mạng** (GoAffPro /
UpPromote / Affiliatly đều được cào qua API của chính họ), tức đoạn giới thiệu trên trang đăng ký — không
phải điều khoản.

| Đo trên `terms_text` | |
|---|---|
| Trung bình | 1.676 ký tự · chỉ 476 dòng vượt 5.000 |
| Bản dài nhất | **HTML thô đầy inline style** (60.000 ký tự) |
| Bản ngắn nhất | **2 ký tự** (`"ce"`) |
| Nhắc tới cấm PPC | **1%** · cấm trademark **1%** · cookie 8% |

## Kết quả — hai vòng

**Vòng 1 (40 chương trình):** đoán đường dẫn `/pages/affiliate*` + thử `join_url` đã lưu.

| Hướng | HTTP 200 | Dùng được¹ |
|---|---|---|
| A. `https://{web}/pages/affiliate*` | 35% | **33%** |
| B. `join_url` (trang đăng ký) | 100% | **8%** |
| B. có link tới điều khoản | | **0%** |
| **Gộp** | | **38%** |

⇒ **Hướng B bỏ đi.** Trang đăng ký truy cập được 100% nhưng gần như không chứa điều khoản, và **không hề
có link** trỏ tới điều khoản.

**Vòng 2 (40 domain khác):** đoán đường dẫn → thất bại thì **đọc `sitemap.xml`** của shop để TÌM trang
(Shopify luôn có `/sitemap.xml` → `sitemap_pages_*.xml` liệt kê mọi trang tĩnh), lọc URL theo từ khoá
`affiliate|ambassador|influencer|creator|partner|referral`.

| Cách | Độ phủ |
|---|---|
| Đoán đường dẫn | 40% |
| **+ sitemap cứu thêm** | **+25%** |
| **TỔNG** | **65%** |

Độ dài trang lấy được: trung vị **8.403** ký tự, tối đa **24.348** — là điều khoản thật, không phải blurb.

¹ "Dùng được" = ≥1.200 ký tự VÀ chạm ≥3 nhóm luật. Ngưỡng tự đặt để loại trang 404-mềm/trang chủ.

## Chi phí và rủi ro chặn

| | |
|---|---|
| Thời gian/domain | trung vị **1,8s** · tệ nhất 7,9s |
| Cào 22.000 chương trình ở 6 luồng | **~1,9 giờ** |
| Bị chặn (403/429) trong 80 domain | **0 lần** |

⇒ Có thể chạy **không cần proxy** ở quy mô này. Nhưng 80 domain là mẫu nhỏ — khi chạy thật vẫn nên qua
pool proxy sẵn có (`sh_proxy`) và có backoff, vì chi phí thêm gần như bằng 0 còn rủi ro thì không.

## Vì sao 35% còn lại không lấy được

| Lý do | Số domain (trên 14 thất bại) |
|---|---|
| Sitemap có trang nhưng **không trang nào khớp từ khoá** | 9 |
| Tìm được trang nhưng **nội dung mỏng** | 5 |

Phần lớn là **shop thật sự không công bố điều khoản** — không phải lỗi kỹ thuật. Đây là trần thực tế, không
phải thứ tối ưu thêm sẽ vượt qua.

## Taxonomy luật PHẢI theo dữ liệu, không theo hiểu biết chung

Độ phủ từng nhóm trên 26 trang lấy được (vòng 2):

| Nhóm luật | Độ phủ | Kết luận |
|---|---|---|
| Hoa hồng % | **92%** | ✅ trụ cột |
| Huỷ/hoàn tiền | **100%** | ⚠️ xem cảnh báo dưới |
| Thanh toán / ngưỡng | **73%** | ✅ |
| Giới hạn địa lý | **73%** | ✅ |
| Thuế / 1099 | **58%** | ✅ |
| Cookie / thời hạn | **38%** | ✅ |
| Cấm coupon / deal site | **31%** | ✅ |
| Sản phẩm loại trừ | **27%** | ✅ |
| Duyệt đơn | **12%** | ➖ |
| **Cấm chạy PPC** | **8%** | ❌ bỏ |
| **Cấm đấu thầu trademark** | **4%** | ❌ bỏ |
| **Cấm tự mua** | **0%** | ❌ bỏ |

**Phát hiện đáng giá nhất:** "cấm PPC", "cấm trademark", "cấm tự mua" — những luật *kinh điển* của affiliate
— gần như **không tồn tại** ở đây. Đó là luật của mạng lớn (Amazon, CJ, Impact); còn đây là shop Shopify nhỏ
dùng GoAffPro/UpPromote. Thiết kế taxonomy theo sách vở sẽ tạo ra mấy mục **vĩnh viễn rỗng**.

## ⚠️ Con số độ phủ luật là cận TRÊN, chưa phải giá trị thật

"Huỷ/hoàn tiền **100%**" không đáng tin: không chương trình nào cũng bàn về hoàn tiền. Nhiều khả năng regex
bắt trúng chữ **"Refund policy" ở chân trang**, vì khảo sát bóc text của **cả trang** gồm menu và footer.

⇒ Phần 2 **bắt buộc** phải tách nội dung chính khỏi khung trang (`<main>`/`<article>`, hoặc cắt bỏ
`<nav>`/`<footer>`/`<header>`) TRƯỚC khi rút trích. Đây là hạng mục công việc thật, không phải chi tiết nhỏ —
bỏ qua nó thì mọi con số luật đều nhiễu.

## Kết luận

**Khả thi.** 65% độ phủ, ~2 giờ cho toàn bộ kho, chưa thấy dấu hiệu bị chặn. Nhưng phạm vi thật của Phần 2
lớn hơn "cào trang rồi regex":

1. Tìm trang: đoán đường dẫn **+ đọc sitemap** (sitemap đóng góp 25/65 độ phủ — bỏ nó là mất hơn 1/3).
2. **Tách nội dung chính** khỏi nav/footer — nếu không, số liệu luật là rác.
3. Rút trích theo taxonomy **đo được** ở trên, không theo sách vở.
4. Lưu riêng (không đè `terms_text` của mạng) + mốc thời gian, để cào lại có kiểm soát.
5. Hiển thị ở `/afflibrary` và `/localdb/shops`.

## Chạy lại khảo sát

Hai script ở scratchpad phiên này (`survey-terms.mjs`, `survey-sitemap.mjs`). Cách làm: lấy mẫu ngẫu nhiên
từ `aff_program ⋈ aff_library` (`aff_status='yes'`, `dns_ok` khác 0), thử tuần tự
`/pages/affiliate-program|-terms|affiliates|affiliate` → `sitemap.xml` → `sitemap_pages_*.xml` → lọc URL theo
từ khoá; chấm "dùng được" bằng ngưỡng ≥1.200 ký tự và ≥3 nhóm luật. Chạy `N=40` mất khoảng 1-2 phút.
