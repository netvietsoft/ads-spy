'use client';

export const PAGE_SIZES = [10, 50, 100, 200, 500, 1000];

export function paginate<T>(arr: T[], page: number, size: number): T[] {
  return arr.slice((page - 1) * size, page * size);
}

export function Paginator({
  total,
  page,
  pageSize,
  onPage,
  onPageSize,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (s: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(page, pages);
  const from = total === 0 ? 0 : (cur - 1) * pageSize + 1;
  const to = Math.min(cur * pageSize, total);

  return (
    <div className="pager">
      <span className="m">
        {from}–{to} / {total}
      </span>
      <span className="pager-ctrl">
        <button className="ghost" disabled={cur <= 1} onClick={() => onPage(cur - 1)}>
          ‹
        </button>
        <span className="m">
          Trang {cur}/{pages}
        </span>
        <button className="ghost" disabled={cur >= pages} onClick={() => onPage(cur + 1)}>
          ›
        </button>
      </span>
      <label className="m">
        Hiển thị{' '}
        <select
          className="fbselect"
          value={pageSize}
          onChange={(e) => {
            onPageSize(Number(e.target.value));
            onPage(1);
          }}
        >
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>{' '}
        / trang
      </label>
    </div>
  );
}
