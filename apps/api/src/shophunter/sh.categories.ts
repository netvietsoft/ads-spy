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
