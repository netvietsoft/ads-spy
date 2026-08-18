import { CreativeBrief } from './api';
import { regionNameEn } from './geo-en';

// Xuất kết quả Google Ads Transparency ra file 9 cột (khớp cấu trúc export của Tool mmo).
// 8 cột lấy thẳng từ CreativeBrief; cột "Quốc gia" cần regionsById (gom bằng job mở chi tiết từng ad).

const HEADERS = [
  'Domain', 'Nhà quảng cáo', 'Mã nhà quảng cáo', 'Quốc gia', 'Creative ID', 'Định dạng',
  'Ngày đầu hiển thị', 'Ngày cuối hiển thị', 'Số ngày chạy', 'Link QC',
];

// assetType nội bộ → nhãn định dạng như xlsx (embed = quảng cáo động = video).
const FMT_LABEL: Record<string, string> = { image: 'image', embed: 'video', text: 'text', unknown: 'unknown' };

function fmtDate(unix?: number): string {
  if (!unix) return '';
  const d = new Date(unix * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function buildExportRows(creatives: CreativeBrief[], regionsById: Record<string, number[]>): string[][] {
  const rows: string[][] = [HEADERS];
  for (const c of creatives) {
    const codes = regionsById[c.creativeId] || [];
    rows.push([
      c.domain || c.ocrDomain || '',
      c.advertiserName || '',
      c.advertiserId || '',
      codes.map(regionNameEn).join(', '),
      c.creativeId,
      FMT_LABEL[c.assetType] || c.assetType,
      fmtDate(c.firstShown),
      fmtDate(c.lastShown),
      c.approxDaysShown != null ? String(c.approxDaysShown) : '',
      `https://adstransparency.google.com/advertiser/${c.advertiserId}/creative/${c.creativeId}`,
    ]);
  }
  return rows;
}

// Chống CSV/formula injection: ô bắt đầu bằng = + - @ (hoặc tab/CR) có thể bị Excel chạy như công thức
// khi mở → chèn dấu ' đứng trước để vô hiệu. Tên nhà quảng cáo là dữ liệu BÊN THỨ BA, phải chặn.
function neutralize(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}
function csvCell(s: string): string {
  const v = neutralize(s);
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function toTxt(rows: string[][]): string {
  // Tab-separated: thay tab/xuống dòng trong ô bằng space để không vỡ cột.
  return rows.map((r) => r.map((c) => neutralize(c).replace(/[\t\r\n]/g, ' ')).join('\t')).join('\n');
}

// Tải chuỗi thành file (UTF-8 có BOM → Excel đọc tiếng Việt đúng).
export function downloadTextFile(filename: string, content: string): void {
  const BOM = '﻿'; // UTF-8 BOM → Excel nhận đúng UTF-8, tiếng Việt không lỗi font
  const blob = new Blob([BOM + content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
