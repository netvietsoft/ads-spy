import tree from './sh-categories.json';

export type CatTree = { top: { name: string; id: string }[]; nodes: Record<string, { name: string; children: string[] }> };

export function loadCatTree(): CatTree {
  return tree as CatTree;
}

export function catRoots(t: CatTree): string[] {
  return t.top.map((x) => x.id);
}

export function catChildren(t: CatTree, id: string): string[] {
  return t.nodes[id]?.children || [];
}

// Từ mảng category_id (LÁ trước, vd ["aa-1-13-1","aa-1-13","aa-1","aa"]) → id lá + đường dẫn tên (gốc→lá).
export function categoryPathFromIds(t: CatTree, ids: any): { id: string | null; path: string } {
  if (!Array.isArray(ids) || !ids.length) return { id: null, path: '' };
  const leaf = String(ids[0]);
  const chain = ids.slice().reverse().map((id: any) => t.nodes[String(id)]?.name || String(id));
  return { id: leaf, path: chain.join(' > ') };
}

// Khớp chuỗi tên folder (vd ["Apparel & Accessories","Clothing","Activewear","Activewear Pants","Joggers"])
// với cây → id lá + đường dẫn tên. Không khớp được cấp nào thì dừng ở cấp khớp cuối; id=null nếu không khớp gì.
export function resolveCategoryByNames(t: CatTree, names: string[]): { id: string | null; path: string } {
  const norm = (s: string) => s.trim().toLowerCase();
  let level = t.top.map((x) => x.id);
  let curId: string | null = null;
  const matched: string[] = [];
  for (const seg of names) {
    const want = norm(seg);
    const found = level.find((id) => norm(t.nodes[id]?.name || '') === want);
    if (!found) break;
    curId = found;
    matched.push(t.nodes[found].name);
    level = t.nodes[found].children || [];
  }
  return { id: curId, path: (matched.length ? matched : names).join(' > ') };
}
