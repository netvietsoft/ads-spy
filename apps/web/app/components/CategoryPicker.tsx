'use client';
import { useEffect, useState } from 'react';

type Tree = { top: { id: string; name: string }[]; nodes: Record<string, { name: string; children?: string[] }> };
let _treeCache: Tree | null = null;

// Cây danh mục bung xổ giống ShopHunter: mở/gập bằng ▸/▾, bấm tên để chọn (mọi cấp), highlight mục đang chọn.
export function CategoryPicker({ onChange }: { onChange: (id: string | null, path: string | null) => void }) {
  const [tree, setTree] = useState<Tree | null>(_treeCache);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<{ id: string; path: string } | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (_treeCache) return;
    fetch('/sh-categories.json').then((r) => r.json()).then((t) => { _treeCache = t; setTree(t); }).catch(() => {});
  }, []);

  if (!tree) return <span style={{ opacity: 0.6 }}>đang tải danh mục…</span>;

  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const choose = (id: string, path: string) => { setSel({ id, path }); onChange(id, path); };

  const renderNode = (id: string, ancestors: string[]): any => {
    const node = tree.nodes[id];
    if (!node) return null;
    const kids = node.children || [];
    const path = [...ancestors, node.name];
    const isExp = expanded.has(id);
    const isSel = sel?.id === id;
    return (
      <div key={id}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, paddingLeft: ancestors.length * 18 }}>
          <span
            onClick={() => kids.length && toggle(id)}
            style={{ width: 16, textAlign: 'center', cursor: kids.length ? 'pointer' : 'default', opacity: kids.length ? 0.8 : 0, userSelect: 'none' }}
          >{kids.length ? (isExp ? '▾' : '▸') : '•'}</span>
          <span
            onClick={() => choose(id, path.join(' > '))}
            title={path.join(' > ')}
            style={{ padding: '2px 8px', borderRadius: 5, cursor: 'pointer', background: isSel ? '#2563eb' : 'transparent', color: isSel ? '#fff' : 'inherit', fontWeight: isSel ? 600 : 400 }}
          >{node.name}</span>
        </div>
        {isExp && kids.map((cid) => renderNode(cid, path))}
      </div>
    );
  };

  // Tìm kiếm: lọc phẳng theo tên (bấm chọn trực tiếp cả đường dẫn).
  const search = q.trim().toLowerCase();
  const matches: { id: string; path: string }[] = [];
  if (search.length >= 2) {
    const walk = (id: string, anc: string[]) => {
      const n = tree.nodes[id]; if (!n) return;
      const path = [...anc, n.name];
      if (n.name.toLowerCase().includes(search)) matches.push({ id, path: path.join(' > ') });
      (n.children || []).forEach((c) => walk(c, path));
    };
    tree.top.forEach((t) => walk(t.id, []));
  }

  return (
    <div style={{ minWidth: 320 }}>
      <input className="fbselect" placeholder="Tìm danh mục (vd: Joggers)…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginBottom: 6 }} />
      <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid rgba(128,128,128,0.35)', borderRadius: 6, padding: 6, fontSize: 14 }}>
        {search.length >= 2
          ? (matches.length
            ? matches.slice(0, 100).map((m) => (
              <div key={m.id} onClick={() => choose(m.id, m.path)} title={m.path}
                style={{ padding: '3px 6px', borderRadius: 5, cursor: 'pointer', background: sel?.id === m.id ? '#2563eb' : 'transparent', color: sel?.id === m.id ? '#fff' : 'inherit' }}>
                {m.path}
              </div>))
            : <div style={{ opacity: 0.6, padding: 6 }}>không thấy “{q}”</div>)
          : tree.top.map((t) => renderNode(t.id, []))}
      </div>
      <div style={{ fontSize: 12, marginTop: 4, minHeight: 18 }}>
        {sel ? <>Đã chọn: <b>{sel.path}</b> <button className="srcbtn" style={{ marginLeft: 6 }} onClick={() => { setSel(null); onChange(null, null); }}>xoá</button></>
          : <span style={{ opacity: 0.6 }}>Chưa chọn danh mục (có thể để trống).</span>}
      </div>
    </div>
  );
}
