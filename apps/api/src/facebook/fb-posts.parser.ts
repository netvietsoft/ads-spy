import { FbPost } from './fb.types';

// Feed post của FB (comet) rất lồng. Chiến lược best-effort:
// đệ quy, mang theo text/url gần nhất (ancestor); khi gặp node có 'reaction_count'
// (= khối feedback) thì chốt 1 post với các số + text/url đang mang.
// LƯU Ý: field có thể đổi theo phiên bản → tinh chỉnh lại bằng response thật khi đã đăng nhập.

function num(v: any): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'number') return v;
  const n = parseInt(String(v).replace(/[^\d]/g, ''), 10);
  return Number.isNaN(n) ? undefined : n;
}

// Làm sạch chuỗi trước khi lưu DB: bỏ CONTROL CHAR + SURROGATE LẺ (emoji bị .slice(0,240) cắt đôi để lại
// nửa cặp UTF-16). Surrogate lẻ khiến Prisma engine báo "unexpected end of hex escape" khi createMany.
function cleanStr(s: string | undefined): string | undefined {
  if (typeof s !== 'string') return s;
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') // control char/null (giữ \t \n \r)
    .replace(/[\uD800-\uDFFF]/g, (ch, idx: number, str: string) => {
      const code = ch.charCodeAt(0);
      if (code <= 0xdbff) return str.charCodeAt(idx + 1) >= 0xdc00 && str.charCodeAt(idx + 1) <= 0xdfff ? ch : '';
      return str.charCodeAt(idx - 1) >= 0xd800 && str.charCodeAt(idx - 1) <= 0xdbff ? ch : '';
    });
}

// Tìm {count|total_count} của 1 key trong subtree, có thể BỎ nhánh (skipKey) — dùng để lấy reaction/share
// của BÀI mà không lọt vào reaction/share của COMMENT (nằm trong comment_rendering_instance).
function deepCount(node: any, key: string, skipKey?: string, depth = 0): number | undefined {
  if (!node || typeof node !== 'object' || depth > 22) return undefined;
  if (!Array.isArray(node)) {
    const v = node[key];
    if (v && typeof v === 'object' && (typeof v.count === 'number' || typeof v.total_count === 'number')) {
      return typeof v.count === 'number' ? v.count : v.total_count;
    }
    for (const k of Object.keys(node)) {
      if (skipKey && k === skipKey) continue;
      const r = deepCount(node[k], key, skipKey, depth + 1);
      if (r != null) return r;
    }
  } else {
    for (const c of node) {
      const r = deepCount(c, key, skipKey, depth + 1);
      if (r != null) return r;
    }
  }
  return undefined;
}

// Đọc reaction/comment/share từ object FEEDBACK CANONICAL của BÀI (mốc comet_ufi_summary_and_actions_renderer).
// Reaction/share lấy TRONG summary-renderer + BỎ nhánh comment_rendering_instance → KHÔNG đếm reaction/share
// của comment (của user). Comment lấy từ comment_rendering_instance.comments.total_count (tổng bình luận bài).
function readFeedback(fb: any): { reactions: number; comments: number; shares: number } {
  const ufi = fb?.comet_ufi_summary_and_actions_renderer ?? fb;
  const reactions =
    deepCount(ufi, 'reaction_count', 'comment_rendering_instance') ?? num(fb?.reaction_count?.count) ?? 0;
  const comments =
    num(fb?.comment_rendering_instance?.comments?.total_count) ??
    num(fb?.aggregated_comment_count) ??
    deepCount(ufi, 'comment_count', 'comment_rendering_instance') ??
    0;
  const shares =
    deepCount(ufi, 'share_count', 'comment_rendering_instance') ??
    deepCount(ufi, 'reshare_count', 'comment_rendering_instance') ??
    num(fb?.share_count?.count) ??
    0;
  return { reactions, comments, shares };
}

const POST_URL_RE = /https?:\/\/[^"'\\ ]*facebook\.com\/[^"'\\ ]*(?:\/posts\/|\/permalink\/|story_fbid=|pfbid)[^"'\\ ]*/i;

const STORY_ID_RE = /(?:story_fbid|top_level_post_id|post_id)\\?":\\?"(\d{6,})"/;

export function parsePagePosts(objs: any[], pageSlug?: string): FbPost[] {
  const byKey = new Map<string, FbPost>();
  // media + story id gần nhất theo THỨ TỰ tài liệu (đứng trước feedback trong mỗi bài)
  let lastMedia: { image?: string; isVideo: boolean } | null = null;
  let lastStoryId: string | null = null;

  const walk = (node: any, text?: string, url?: string, time?: number) => {
    // chuỗi: dò story id trong payload đã stringify (story_fbid/top_level_post_id/post_id)
    if (typeof node === 'string') {
      const m = STORY_ID_RE.exec(node);
      if (m) lastStoryId = m[1];
      return;
    }
    if (!node || typeof node !== 'object') return;

    // node media (có field is_playable) → nhớ ảnh/thumbnail + loại video
    if (!Array.isArray(node) && 'is_playable' in node) {
      const img =
        node.preferred_thumbnail?.image?.uri || node.image?.uri || node.viewer_image?.uri;
      if (img) lastMedia = { image: img, isVideo: node.is_playable === true };
    }

    // cập nhật ngữ cảnh text/url/time theo nhánh
    let curText = text;
    let curUrl = url;
    let curTime = time;
    const msg = node.message?.text || node.title?.text || node.body?.text;
    if (typeof msg === 'string' && msg.length > curText?.length!) curText = msg;
    else if (typeof msg === 'string' && !curText) curText = msg;
    for (const k of ['url', 'wwwURL', 'permalink_url', 'story_permalink_url']) {
      const u = node[k];
      if (typeof u === 'string' && POST_URL_RE.test(u)) curUrl = u;
    }
    for (const k of ['creation_time', 'publish_time', 'created_time']) {
      const tt = node[k];
      if (typeof tt === 'number' && tt > 1_000_000_000 && tt < 20_000_000_000) curTime = tt;
    }

    // node feedback — CHỈ chốt ở object FEEDBACK CANONICAL của bài (có comet_ufi_summary_and_actions_renderer,
    // hoặc kiểu cũ reaction_count + share_count). KHÔNG chốt ở leaf reaction-icon-renderer (thiếu comment/share
    // → reaction bài đúng bài sai + comment/share = 0). Đây là fix gốc cho cả 3 lỗi đó.
    const isPostFeedback =
      (node.comet_ufi_summary_and_actions_renderer && typeof node.comet_ufi_summary_and_actions_renderer === 'object') ||
      (node.reaction_count && typeof node.reaction_count === 'object' && node.share_count);
    if (isPostFeedback) {
      const { reactions, comments, shares } = readFeedback(node);
      // URL permalink nằm ngay trên object feedback → đáng tin hơn curUrl kế thừa từ tổ tiên.
      const fbUrl = typeof node.url === 'string' && POST_URL_RE.test(node.url) ? node.url : undefined;
      if (fbUrl) curUrl = fbUrl;
      const idFromUrl = curUrl ? (/(pfbid[\w]+|\/posts\/\d+|story_fbid=\d+|\/permalink\/\d+)/.exec(curUrl) || [])[0] : undefined;
      const storyId = node.subscription_target_id || node.associated_story_id || lastStoryId || undefined;
      const postId = storyId || idFromUrl;
      // Dựng link nếu feed không trả sẵn URL: facebook.com/<page>/posts/<storyId>
      if (!curUrl && pageSlug && storyId && /^\d{6,}$/.test(String(storyId))) {
        curUrl = `https://www.facebook.com/${pageSlug}/posts/${storyId}`;
      }
      const key = curUrl || postId || `${curText?.slice(0, 40)}#${reactions}`;
      if (key && (reactions || comments || shares)) {
        const total = reactions + comments + shares;
        const prev = byKey.get(key);
        if (!prev || total > prev.total) {
          byKey.set(key, {
            postId: typeof postId === 'string' ? cleanStr(postId) : undefined,
            url: cleanStr(curUrl),
            text: cleanStr(curText?.replace(/\s+/g, ' ').trim().slice(0, 240)),
            time: curTime,
            image: cleanStr(lastMedia?.image),
            isVideo: lastMedia?.isVideo ?? false,
            reactions,
            comments,
            shares,
            total,
          });
        }
      }
      lastMedia = null; // reset sau mỗi bài để không rò sang bài kế
      lastStoryId = null;
    }

    if (Array.isArray(node)) {
      for (const c of node) walk(c, curText, curUrl, curTime);
    } else {
      for (const k of Object.keys(node)) walk(node[k], curText, curUrl, curTime);
    }
  };

  for (const o of objs) walk(o);
  return [...byKey.values()];
}
