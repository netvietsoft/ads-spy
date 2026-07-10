'use client';
import { useEffect, useState } from 'react';

type Tree = { top: { name: string; id: string }[]; nodes: Record<string, { name: string; children: string[] }> };
export function ShCategories({ selected, onChange }: { selected: string[]; onChange: (keys: string[]) => void }) {
  const [tree, setTree] = useState<Tree | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => { fetch('/sh-categories.json').then((r) => r.json()).then(setTree).catch(() => {}); }, []);
  if (!tree) return <div style={{ opacity: 0.6, fontSize: 12 }}>Đang tải categories…</div>;
  const toggleSel = (key: string) => onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  const Node = ({ k, label }: { k: string; label: string }) => {
    const node = tree.nodes[k];
    const kids = node?.children || [];
    return (
      <div style={{ marginLeft: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {kids.length ? <span style={{ cursor: 'pointer', width: 12 }} onClick={() => setOpen((o) => ({ ...o, [k]: !o[k] }))}>{open[k] ? '▾' : '▸'}</span> : <span style={{ width: 12 }} />}
          <label style={{ fontSize: 13 }}><input type="checkbox" checked={selected.includes(k)} onChange={() => toggleSel(k)} /> {label}</label>
        </div>
        {open[k] && kids.map((ck) => <Node key={ck} k={ck} label={tree.nodes[ck]?.name || ck} />)}
      </div>
    );
  };
  return (
    <div className="shcats" style={{ maxHeight: 320, overflow: 'auto' }}>
      {tree.top.map((t) => <Node key={t.id} k={t.id} label={t.name} />)}
    </div>
  );
}
