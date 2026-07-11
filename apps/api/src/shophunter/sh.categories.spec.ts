import { loadCatTree, catRoots, catChildren } from './sh.categories';

describe('sh.categories', () => {
  it('loads cat tree with expected shape', () => {
    const t = loadCatTree();
    expect(t.top.length).toBeGreaterThanOrEqual(20);
    expect(catChildren(t, 'aa-1')).toContain('aa-1-1');
    expect(catRoots(t)).toContain('aa');
  });
});
