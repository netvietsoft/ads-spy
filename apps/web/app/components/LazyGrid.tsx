'use client';
import { ReactNode, useEffect, useRef, useState } from 'react';

// Render dần theo lô: chỉ hiện `step` card đầu, cuộn tới cuối thì hiện thêm.
// Ảnh dùng loading="lazy" nên chỉ card vào tầm nhìn mới tải media → nhẹ khi nhiều ad.
export function LazyGrid<T>({
  items,
  render,
  className,
  step = 24,
}: {
  items: T[];
  render: (item: T, index: number) => ReactNode;
  className?: string;
  step?: number;
}) {
  const [n, setN] = useState(step);
  const sentinel = useRef<HTMLDivElement>(null);

  // reset khi đổi dữ liệu
  useEffect(() => {
    setN(step);
  }, [items, step]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) setN((v) => Math.min(v + step, items.length));
      },
      { rootMargin: '600px' }, // nạp trước khi tới đáy
    );
    io.observe(el);
    return () => io.disconnect();
  }, [items, n, step]);

  return (
    <>
      <div className={className}>{items.slice(0, n).map(render)}</div>
      {n < items.length && <div ref={sentinel} style={{ height: 1 }} aria-hidden />}
    </>
  );
}
