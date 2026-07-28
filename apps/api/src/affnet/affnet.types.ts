// DTO thuần cho module affnet — không import Nest/mysql/playwright.

export interface ParsedProgram {
  programName: string | null;
  brand: string | null;
  web: string | null;
  commissionPct: number | null;
  commissionFlat: number | null;
  commissionCurrency: string | null;
  commissionScope: string | null;
  commissionRaw: string | null;
  cookieDays: number | null;
  payoutThreshold: number | null;
  notes: string | null;
}

// Kết quả 1 lần fetch 1 host. 'blocked' KHÔNG BAO GIỜ được lưu vào aff_host.check_status.
export type FetchOutcome = 'active' | 'inactive' | 'notfound' | 'blocked' | 'error';

export interface AffNet {
  net: string;
  platform: string;
  enabled: boolean;
  note: string | null;
  discoverPolledAt: number | null;
  discoverPolls: number;
  discoverLastNew: number | null;
  fakeLen: number | null;
  fakeHash: string | null;
  fakeCheckedAt: number | null;
}

export interface AffHostRow {
  net: string;
  slug: string;
  firstSeen: number;
  lastSeen: number;
  sources: string;
  checkedAt: number | null;
  checkStatus: string | null;
  checkTries: number;
}

// Kết quả discovery 1 slug + những nguồn nào đã thấy nó (dùng ở affnet.discovery.ts và affnet.mysql.ts).
export interface DiscoveredHost {
  slug: string;
  sources: string[];
}

// 1 proxy trong pool xoay dùng chung (sh_proxy). Chỉ HTTP — Playwright newContext({proxy}) nhận http.
export interface ProxyOpt {
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
}

export interface AffProgram extends ParsedProgram {
  net: string;
  slug: string;
  joinUrl: string;
  termsText: string | null;   // toàn văn điều khoản → re-parse offline, KHÔNG cào lại
  status: 'active' | 'inactive';
  fetchedAt: number;
}

export interface NetSummary {
  net: string;
  platform: string;
  discovered: number;   // tổng host trong aff_host
  checked: number;      // đã quét
  active: number;       // dự án còn sống
  pending: number;      // còn chờ quét
  polls: number;
  lastNew: number | null;
  buckets: Record<string, number>; // '0-10' | '10-15' | '15-20' | '20-30' | '30+' | 'flat' | 'unknown'
}
