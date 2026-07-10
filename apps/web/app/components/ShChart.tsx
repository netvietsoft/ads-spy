'use client';
export function ShChart({ points, height = 120, color = '#41d18a' }: { points: { date_str: string; value: number | null }[]; height?: number; color?: string }) {
  const pts = points.filter((p) => typeof p.value === 'number') as { date_str: string; value: number }[];
  if (pts.length < 2) return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5, fontSize: 12 }}>Chưa đủ dữ liệu biểu đồ</div>;
  const W = 600, H = height, pad = 6;
  const vals = pts.map((p) => p.value);
  const max = Math.max(...vals), min = Math.min(...vals, 0);
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (pts.length - 1);
  const y = (v: number) => H - pad - ((v - min) / (max - min || 1)) * (H - 2 * pad);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;
  return (
    <div style={{ width: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }}>
        <path d={area} fill={color} opacity={0.12} />
        <path d={line} fill="none" stroke={color} strokeWidth={2} />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, opacity: 0.6 }}>
        <span>{pts[0].date_str}</span>
        <span>max ${Math.round(max).toLocaleString()}</span>
        <span>{pts[pts.length - 1].date_str}</span>
      </div>
    </div>
  );
}
