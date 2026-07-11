import { buildDeepSlices } from './sh.slices';
const tree: any = { top: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], nodes: {
  a: { name: 'A', children: ['a-1', 'a-2'] }, 'a-1': { name: 'A1', children: [] }, 'a-2': { name: 'A2', children: [] },
  b: { name: 'B', children: [] } } };
it('đào con khi >cap, emit khi ≤cap, lá>cap→capped, 0→bỏ', async () => {
  const hits: Record<string, number> = { a: 5000, 'a-1': 200, 'a-2': 2000, b: 0 };
  const slices = await buildDeepSlices(tree, async (id) => hits[id] ?? 0, 960);
  expect(slices.find((s) => s.catId === 'a')).toBeUndefined();      // >cap có con → đào
  expect(slices.find((s) => s.catId === 'a-1')).toMatchObject({ total: 200, capped: false });
  expect(slices.find((s) => s.catId === 'a-2')).toMatchObject({ total: 2000, capped: true }); // lá >cap
  expect(slices.find((s) => s.catId === 'b')).toBeUndefined();      // 0 → bỏ
});
