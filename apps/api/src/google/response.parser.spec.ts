import * as fs from 'fs';
import * as path from 'path';
import {
  parseSearchCreatives,
  parseAdvertisers,
  parseCreativeDetail,
  parseSuggest,
  extractImageUrl,
} from './response.parser';

const FX = path.join(__dirname, '../../../../fixtures');
const load = (f: string) => JSON.parse(fs.readFileSync(path.join(FX, f), 'utf8'));

describe('response.parser', () => {
  describe('parseSearchCreatives (domain fixture)', () => {
    const res = parseSearchCreatives(load('search-creatives-domain.json'));

    it('extracts creatives with ids, advertiser, domain', () => {
      expect(res.creatives.length).toBeGreaterThan(0);
      const c = res.creatives[0];
      expect(c.advertiserId).toMatch(/^AR/);
      expect(c.creativeId).toMatch(/^CR/);
      expect(c.advertiserName).toBeTruthy();
      expect(c.domain).toBe('nike.com');
    });

    it('parses an image creative asset url', () => {
      const img = res.creatives.find((c) => c.assetType === 'image');
      expect(img).toBeDefined();
      expect(img!.assetUrl).toContain('tpc.googlesyndication.com/archive/simgad');
    });

    it('parses timestamps and pagination + totals', () => {
      const c = res.creatives[0];
      expect(typeof c.lastShown).toBe('number');
      expect(res.nextPageToken).toBeTruthy();
      expect(res.totalMin).toBe(100000);
      expect(res.totalMax).toBe(200000);
    });
  });

  it('parseAdvertisers groups by advertiser id and counts', () => {
    const res = parseSearchCreatives(load('search-creatives-domain.json'));
    const advs = parseAdvertisers(res.creatives);
    expect(advs.length).toBeGreaterThan(0);
    const sum = advs.reduce((n, a) => n + a.adCount, 0);
    expect(sum).toBe(res.creatives.length);
    expect(advs[0].id).toMatch(/^AR/);
    expect(advs[0].name).toBeTruthy();
  });

  describe('parseCreativeDetail (image fixture)', () => {
    const d = parseCreativeDetail(load('get-creative-image.json'));
    it('extracts variants, regions, advertiser name', () => {
      expect(d.creativeId).toBe('CR06080838414486208513');
      expect(d.advertiserId).toBe('AR16735076323512287233');
      expect(d.variants.length).toBe(5);
      expect(d.variants.some((v) => v.assetType === 'image')).toBe(true);
      expect(d.variants.some((v) => v.assetType === 'embed')).toBe(true);
      expect(d.regions).toContain(2840);
      expect(d.advertiserName).toBe('Nike, Inc.');
    });
  });

  describe('parseSuggest', () => {
    const s = parseSuggest(load('suggest.json'));
    it('extracts advertisers and domains', () => {
      expect(s.advertisers.length).toBeGreaterThan(0);
      expect(s.advertisers[0].id).toMatch(/^AR/);
      expect(s.advertisers[0].name).toBeTruthy();
      expect(s.domains).toContain('nike.com');
    });
  });

  describe('extractImageUrl', () => {
    it('pulls src from an img tag', () => {
      expect(extractImageUrl('<img src="https://x/y.png" height="1">')).toBe('https://x/y.png');
    });
    it('returns undefined when no src', () => {
      expect(extractImageUrl('no image here')).toBeUndefined();
    });
  });
});
