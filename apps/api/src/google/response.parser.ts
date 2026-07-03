import {
  Advertiser,
  AssetType,
  CreativeBrief,
  CreativeDetail,
  CreativeVariant,
  SearchCreativesResult,
  SuggestResult,
} from './google.types';

export function extractImageUrl(html: string): string | undefined {
  const m = /src="([^"]+)"/.exec(html);
  return m ? m[1] : undefined;
}

function toInt(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isNaN(n) ? undefined : n;
}

// Một "preview" node có thể là:
//  - ảnh:   node["3"]["2"] = '<img src="...">'
//  - embed: node["1"]["4"] = 'https://displayads.../content.js?...'
//  - text:  node["2"] = chuỗi text
function parseAsset(node: any): { assetType: AssetType; assetUrl?: string } {
  if (!node || typeof node !== 'object') return { assetType: 'unknown' };
  const imgHtml = node['3']?.['2'];
  if (typeof imgHtml === 'string') {
    return { assetType: 'image', assetUrl: extractImageUrl(imgHtml) };
  }
  const embed = node['1']?.['4'];
  if (typeof embed === 'string') {
    return { assetType: 'embed', assetUrl: embed };
  }
  if (typeof node['2'] === 'string') {
    return { assetType: 'text', assetUrl: undefined };
  }
  return { assetType: 'unknown' };
}

export function parseSearchCreatives(raw: any): SearchCreativesResult {
  const list: any[] = Array.isArray(raw?.['1']) ? raw['1'] : [];
  const creatives: CreativeBrief[] = list.map((ad) => {
    const asset = parseAsset(ad?.['3']);
    return {
      creativeId: ad?.['2'],
      advertiserId: ad?.['1'],
      advertiserName: ad?.['12'] ?? '',
      domain: ad?.['14'],
      assetType: asset.assetType,
      assetUrl: asset.assetUrl,
      firstShown: toInt(ad?.['6']?.['1']),
      lastShown: toInt(ad?.['7']?.['1']),
      regionCount: toInt(ad?.['13']),
    };
  });
  return {
    creatives,
    nextPageToken: raw?.['2'] || undefined,
    totalMin: toInt(raw?.['4']),
    totalMax: toInt(raw?.['5']),
  };
}

export function parseAdvertisers(creatives: CreativeBrief[]): Advertiser[] {
  const map = new Map<string, Advertiser>();
  for (const c of creatives) {
    if (!c.advertiserId) continue;
    const existing = map.get(c.advertiserId);
    if (existing) {
      existing.adCount += 1;
    } else {
      map.set(c.advertiserId, {
        id: c.advertiserId,
        name: c.advertiserName,
        domain: c.domain,
        adCount: 1,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.adCount - a.adCount);
}

export function parseCreativeDetail(raw: any): CreativeDetail {
  const root = raw?.['1'] ?? {};
  const variantNodes: any[] = Array.isArray(root['5']) ? root['5'] : [];
  const variants: CreativeVariant[] = variantNodes.map((n) => parseAsset(n));
  const regionNodes: any[] = Array.isArray(root['17']) ? root['17'] : [];
  const regions = regionNodes.map((r) => toInt(r?.['1'])).filter((n): n is number => n !== undefined);
  return {
    creativeId: root['2'],
    advertiserId: root['1'],
    advertiserName: root['22']?.['1'],
    lastShown: toInt(root['4']?.['1']),
    variants,
    regions,
  };
}

export function parseSuggest(raw: any): SuggestResult {
  const list: any[] = Array.isArray(raw?.['1']) ? raw['1'] : [];
  const advertisers: Advertiser[] = [];
  const domains: string[] = [];
  for (const item of list) {
    if (item?.['1']) {
      const a = item['1'];
      advertisers.push({
        id: a['2'],
        name: a['1'],
        adCount: toInt(a['4']?.['2']?.['2']) ?? 0,
      });
    } else if (item?.['2']?.['1']) {
      domains.push(item['2']['1']);
    }
  }
  return { advertisers, domains };
}
