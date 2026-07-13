'use client';
import { useEffect, useRef, useState } from 'react';

type Tree = { top: { id: string; name: string }[]; nodes: Record<string, { name: string; children?: string[] }> };
let _treeCache: Tree | null = null;

// Chọn danh mục dạng 1 dòng: bấm để xổ cây (giống ShopHunter), chọn xong tự thu lại. Bấm ra ngoài để đóng.
export function CategoryPicker({ onChange }: { onChange: (id: string | null, path: string | null) => void }) {
  const [tree, setTree] = useState<Tree | null>(_treeCache);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<{ id: string; path: string } | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (_treeCache) return;
    fetch('/sh-categories.json').then((r) => r.json()).then((t) => { _treeCache = t; setTree(t); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const choose = (id: string, path: string) => { setSel({ id, path }); onChange(id, path); setOpen(false); };
  const clear = (e: React.MouseEvent) => { e.stopPropagation(); setSel(null); onChange(null, null); };

  const renderNode = (id: string, ancestors: string[]): any => {
    if (!tree) return null;
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
  if (tree && search.length >= 2) {
    const walk = (id: string, anc: string[]) => {
      const n = tree.nodes[id]; if (!n) return;
      const path = [...anc, n.name];
      if (n.name.toLowerCase().includes(search)) matches.push({ id, path: path.join(' > ') });
      (n.children || []).forEach((c) => walk(c, path));
    };
    tree.top.forEach((t) => walk(t.id, []));
  }

  return (
    <div ref={boxRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button" className="fbselect" onClick={() => setOpen((o) => !o)}
        style={{ minWidth: 200, maxWidth: 320, textAlign: 'left', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}
        title={sel ? sel.path : 'Tất cả danh mục'}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sel ? sel.path : 'Tất cả'}</span>
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          {sel && <span onClick={clear} title="Xoá" style={{ opacity: 0.7, cursor: 'pointer', fontWeight: 700 }}>✕</span>}
          <span style={{ opacity: 0.7 }}>▾</span>
        </span>
      </button>
      {open && (
        <div style={{ position: 'absolute', zIndex: 60, top: 'calc(100% + 4px)', left: 0, width: 340, maxWidth: '90vw', background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, boxShadow: '0 10px 30px rgba(0,0,0,0.35)' }}>
          {!tree ? <span style={{ opacity: 0.6 }}>đang tải danh mục…</span> : (
            <>
              <input className="fbselect" placeholder="Tìm danh mục (vd: Joggers)…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginBottom: 6 }} autoFocus />
              <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: 6, fontSize: 14 }}>
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
