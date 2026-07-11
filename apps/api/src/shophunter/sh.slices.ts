import { CatTree, catRoots, catChildren } from './sh.categories';
export const SLICE_CAP = 960;
export async function buildDeepSlices(tree: CatTree, totalHitsOf: (c: string) => Promise<number>, cap = SLICE_CAP) {
  const out: { catId: string; total: number; capped: boolean }[] = [];
  const queue = [...catRoots(tree)];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue; seen.add(id);
    const n = await totalHitsOf(id);
    if (!n) continue;
    if (n <= cap) { out.push({ catId: id, total: n, capped: false }); continue; }
    const kids = catChildren(tree, id);
    if (kids.length) queue.push(...kids);
    else out.push({ catId: id, total: n, capped: true });
  }
  return out;
}
