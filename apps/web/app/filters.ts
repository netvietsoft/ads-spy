import { CreativeBrief } from './api';

// Bộ lọc CLIENT-SIDE cho kết quả Google Ads Transparency.
//
// Vì sao client-side: API nội bộ Google KHÔNG nhận filter theo định dạng hay khoảng ngày trong request
// (xem docs/archive/03 + CLAUDE.md: "Loại asset suy từ preview, KHÔNG tin format code"). Ngày chỉ là
// OUTPUT trên từng creative (firstShown/lastShown, unix GIÂY). Nên ta fetch rồi lọc tại đây, dùng chính
// dữ liệu Google trả — trung thực, không bịa filter server không có.

export type FormatFilter = 'all' | 'text' | 'image' | 'video';

// "video" trong UI = creative động (embed content.js) — dữ liệu nội bộ không có loại "shopping" riêng,
// chỉ có image / embed / text / unknown.
const FMT_TO_ASSET: Record<Exclude<FormatFilter, 'all'>, CreativeBrief['assetType']> = {
  text: 'text',
  image: 'image',
  video: 'embed',
};

export interface ClientFilters {
  preset: number; // "còn chạy trong N ngày gần nhất"; 0 = tất cả
  dateFrom?: string; // yyyy-mm-dd (rỗng = bỏ qua)
  dateTo?: string; // yyyy-mm-dd
  fmt: FormatFilter;
  // Định dạng THẬT theo creativeId (từ field 8, gom qua detail). Có → lọc chính xác text/image/video.
  // Không có (chưa gom) → rơi về suy-đoán-preview (assetType) vốn KHÔNG phân biệt được text với image.
  formatById?: Record<string, string>;
  now?: number; // unix GIÂY — tiêm được để test; mặc định thời điểm hiện tại
}

// Lọc theo định dạng + cửa sổ thời gian. Cửa sổ ưu tiên khoảng ngày tường minh (from/to); nếu không đặt
// mà có preset thì dùng [now - N ngày, now]. Một creative "khớp cửa sổ" khi khoảng hoạt động của nó
// [firstShown, lastShown] GIAO với cửa sổ đã chọn. Khi có lọc ngày mà creative thiếu cả 2 mốc → loại
// (không xác minh được là đã chạy trong cửa sổ, nên không giữ để tránh kết quả gây hiểu nhầm).
export function applyClientFilters(list: CreativeBrief[], f: ClientFilters): CreativeBrief[] {
  let out = list;

  if (f.fmt !== 'all') {
    if (f.formatById) {
      out = out.filter((c) => (f.formatById![c.creativeId] || '') === f.fmt);
    } else {
      const want = FMT_TO_ASSET[f.fmt];
      out = out.filter((c) => c.assetType === want);
    }
  }

  const now = f.now ?? Math.floor(Date.now() / 1000);
  let from = 0;
  let to = Number.POSITIVE_INFINITY;
  let active = false;
  if (f.dateFrom) {
    from = Math.floor(new Date(`${f.dateFrom}T00:00:00`).getTime() / 1000);
    active = true;
  }
  if (f.dateTo) {
    to = Math.floor(new Date(`${f.dateTo}T23:59:59`).getTime() / 1000);
    active = true;
  }
  if (!active && f.preset > 0) {
    from = now - f.preset * 86400;
    to = now;
    active = true;
  }

  if (active) {
    out = out.filter((c) => {
      const fs = c.firstShown;
      const ls = c.lastShown;
      if (fs == null && ls == null) return false; // thiếu mốc → không xác minh được
      const start = fs ?? (ls as number);
      const end = ls ?? (fs as number);
      return end >= from && start <= to; // giao khoảng
    });
  }

  return out;
}
