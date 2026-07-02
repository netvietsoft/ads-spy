import { FbAd } from './fb.types';

// Response GraphQL của Ad Library rất lồng nhau và hay đổi lớp bọc ngoài.
// Chiến lược bền: đệ quy quét MỌI object có 'ad_archive_id' -> đó là 1 node quảng cáo,
// rồi bóc field từ 'snapshot' một cách phòng thủ.

function collectAdNodes(root: any): any[] {
  const out: any[] = [];
  const seen = new Set<any>();
  const walk = (v: any) => {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (v.ad_archive_id || v.adArchiveID) out.push(v);
    for (const k of Object.keys(v)) walk(v[k]);
  };
  walk(root);
  return out;
}

function pushImages(snap: any, images: string[], videos: string[]) {
  if (!snap || typeof snap !== 'object') return;
  const imgUrl = snap.original_image_url || snap.resized_image_url;
  if (imgUrl) images.push(imgUrl);
  const vidUrl = snap.video_hd_url || snap.video_sd_url;
  if (vidUrl) videos.push(vidUrl);
  if (snap.video_preview_image_url) images.push(snap.video_preview_image_url);
  if (Array.isArray(snap.images)) snap.images.forEach((x: any) => pushImages(x, images, videos));
  if (Array.isArray(snap.videos)) snap.videos.forEach((x: any) => pushImages(x, images, videos));
  if (Array.isArray(snap.cards)) snap.cards.forEach((x: any) => pushImages(x, images, videos));
}

function uniq(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))];
}

export function mapAdNode(node: any): FbAd {
  const id = String(node.ad_archive_id || node.adArchiveID || '');
  const snap = node.snapshot || node.snapshot_v2 || {};
  const images: string[] = [];
  const videos: string[] = [];
  pushImages(snap, images, videos);

  const start = node.start_date || node.startDate;
  return {
    adArchiveId: id,
    pageId: String(node.page_id || snap.page_id || '') || undefined,
    pageName: node.page_name || snap.page_name || snap.page_profile_name || '',
    pageProfileUri: snap.page_profile_uri || undefined,
    startedRunning:
      typeof start === 'number' ? new Date(start * 1000).toISOString().slice(0, 10) : start,
    isActive: node.is_active ?? node.isActive,
    platforms: node.publisher_platform || snap.publisher_platform || node.publisherPlatform,
    bodyText: snap.body?.text || snap.body?.markup?.__html || snap.caption || snap.title,
    linkUrl: snap.link_url || undefined,
    ctaText: snap.cta_text || snap.cta_type || undefined,
    images: uniq(images),
    videos: uniq(videos),
    snapshotUrl: id ? `https://www.facebook.com/ads/library/?id=${id}` : undefined,
  };
}

export function parseFbGraphql(json: any): FbAd[] {
  const nodes = collectAdNodes(json);
  const byId = new Map<string, FbAd>();
  for (const n of nodes) {
    const ad = mapAdNode(n);
    if (ad.adArchiveId && !byId.has(ad.adArchiveId)) byId.set(ad.adArchiveId, ad);
  }
  return [...byId.values()];
}
