import { createHash } from 'crypto';

// Hash ổn định cho 1 truy vấn explore → khoá cache. categoryIds sort để không phụ thuộc thứ tự.
export function shQueryHash(
  searchType: string,
  opts: { sort: string; q: string; categoryIds: string[]; from: number; filters?: Record<string, { gte: number | null; lte: number | null }> },
): string {
  const norm = JSON.stringify({
    t: searchType,
    s: opts.sort,
    q: opts.q || '',
    c: [...(opts.categoryIds || [])].sort(),
    f: opts.from || 0,
    fl: Object.keys(opts.filters || {}).sort().map((k) => [k, opts.filters![k].gte ?? null, opts.filters![k].lte ?? null]),
  });
  return createHash('sha1').update(norm).digest('hex');
}
