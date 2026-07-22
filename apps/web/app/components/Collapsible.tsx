'use client';
import { ReactNode, useState } from 'react';

// Nhóm lọc thu/xổ: header bấm được + mũi tên ▾ (xoay khi mở), chấm sáng khi nhóm đang có lọc. Mặc định thu.
export function Collapsible({ title, active, defaultOpen = false, children }:
  { title: string; active?: boolean; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`shcol ${open ? 'open' : ''}`}>
      <button type="button" className="shcol-head" onClick={() => setOpen(!open)}>
        <span className="shcol-title">{title}{active ? <span className="shcol-dot" /> : null}</span>
        <span className="shcol-chev">▾</span>
      </button>
      {open && <div className="shcol-body">{children}</div>}
    </div>
  );
}
