'use client';
import { useEffect, useState } from 'react';

// Mobile: dưới 760px hiện dạng THẺ (khỏi vỡ bảng nhiều cột). matchMedia (SSR-safe: false lúc đầu).
// Tách ra dùng chung cho Local DB / Aff Library / Affiliate Nets — 3 bảng đều nhiều cột.
export function useIsMobile(bp = 760) {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${bp}px)`);
    const on = () => setM(mq.matches); on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [bp]);
  return m;
}
