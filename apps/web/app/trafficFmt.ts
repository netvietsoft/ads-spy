// Format + chuỗi tháng cho traffic — dùng CHUNG bởi TrafficPanel (/traffic) và TrafficHistoryModal
// (nút 📊 ở /affnet/{net}). Tách ra để 2 nơi không lệch cách hiển thị số.

// Ép locale 'vi-VN' (946.768.445) thay vì theo locale máy — máy en-US ra 946,768,445, lệch thiết kế.
export function formatNumber(value: any): string {
  if (value === null || value === undefined) return 'N/A';
  try {
    const num = typeof value === 'string' ? parseInt(value, 10) : value;
    if (Number.isNaN(num)) return String(value);
    return num.toLocaleString('vi-VN');
  } catch {
    return String(value);
  }
}
export function formatBounceRate(value: number): string {
  if (value === null || value === undefined) return 'N/A';
  return `${value.toFixed(1)}%`;
}
export function formatTimeOnSite(value: number | null): string {
  if (value === null || value === undefined) return 'N/A';
  return `${Math.round(value)}s`;
}
export function formatPages(value: number | null): string {
  if (value === null || value === undefined) return 'N/A';
  return value.toFixed(1);
}
export function formatRank(value: number | null): string {
  if (value === null || value === undefined) return 'N/A';
  return `#${value.toLocaleString('vi-VN')}`;
}

// Key AITDK là NGÀY ĐẦU THÁNG "YYYY-MM-01" → nhãn "MM/YY". deltaPct so với THÁNG LIỀN TRƯỚC
// (tháng đầu tiên không có mốc so → null). Số tháng KHÔNG luôn là 12: AITDK trả khác nhau theo domain.
export interface MonthPoint { key: string; label: string; visits: number; deltaPct: number | null }
export function monthSeries(mv?: Record<string, number> | null): MonthPoint[] {
  if (!mv) return [];
  const keys = Object.keys(mv).sort();
  return keys.map((k, i) => {
    const visits = Number(mv[k]) || 0;
    const prev = i > 0 ? Number(mv[keys[i - 1]]) || 0 : 0;
    return {
      key: k,
      label: `${k.slice(5, 7)}/${k.slice(2, 4)}`,
      visits,
      deltaPct: i === 0 || !prev ? null : ((visits - prev) / prev) * 100,
    };
  });
}
