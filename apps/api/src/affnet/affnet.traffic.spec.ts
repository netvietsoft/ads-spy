// Parser khối text extension. HÀM THUẦN — text mẫu là khối overview THẬT từ extension AITDK.
import { parseTrafficPaste } from './affnet.traffic';

// Khối overview thật (số trên, nhãn dưới — như extension hiển thị), copy ra thành nhiều dòng:
const PANEL = `42.67M
Monthly Visits
40.64%
Bounce Rate
6.06
Pages Per Visit
00:04:25
Visit Duration
781
Global Rank
423
Country Rank`;

describe('parseTrafficPaste — khối overview thật', () => {
  it('tách đúng cả 4 trường từ panel thật', () => {
    const r = parseTrafficPaste(PANEL);
    expect(r.visits).toBe(42670000);
    expect(r.bounceRate).toBeCloseTo(40.64, 2);
    expect(r.visitDurationSec).toBe(265);   // 4*60+25
    expect(r.rank).toBe(781);               // Global Rank, KHÔNG phải Country Rank 423
  });
  it('KHÔNG nhầm "Pages Per Visit" thành visits', () => {
    expect(parseTrafficPaste(PANEL).visits).toBe(42670000); // không phải 6
  });
  it('KHÔNG nhầm "Country Rank" thành global rank', () => {
    expect(parseTrafficPaste(PANEL).rank).toBe(781);        // không phải 423
  });
});

describe('parseTrafficPaste — biến thể số', () => {
  it('site nhỏ "1,039 Monthly Visits" → 1039', () => {
    expect(parseTrafficPaste('1,039 Monthly Visits').visits).toBe(1039);
  });
  it('"1.2K" → 1200', () => {
    expect(parseTrafficPaste('1.2K Monthly Visits').visits).toBe(1200);
  });
  it('duration mm:ss "4:25" → 265', () => {
    expect(parseTrafficPaste('Visit Duration 4:25').visitDurationSec).toBe(265);
  });
  it('duration hh:mm:ss "1:02:03" → 3723', () => {
    expect(parseTrafficPaste('1:02:03 Visit Duration').visitDurationSec).toBe(3723);
  });
  it('thứ tự nhãn-trước-số vẫn parse (Bounce Rate 38.63%)', () => {
    expect(parseTrafficPaste('Bounce Rate 38.63%').bounceRate).toBeCloseTo(38.63, 2);
  });
  it('text rỗng / rác → mọi trường null, không ném', () => {
    const r = parseTrafficPaste('hello world');
    expect(r).toEqual({ visits: null, bounceRate: null, visitDurationSec: null, rank: null });
  });
});
