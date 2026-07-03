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

function readFeedback(fb: any): { reactions: number; comments: number; shares: number } {
  const reactions = num(fb?.reaction_count?.count) ?? num(fb?.reaction_count?.total_count) ?? 0;
  const comments =
    num(fb?.comment_rendering_instance?.comments?.total_count) ??
    num(fb?.comments_count_summary_renderer?.feedback?.comment_count?.total_count) ??
    num(fb?.total_comment_count) ??
    num(fb?.comment_count?.total_count) ??
    0;
  const shares = num(fb?.share_count?.count) ?? num(fb?.reshare_count?.count) ?? num(fb?.share_count_reduced) ?? 0;
  return { reactions, comments, shares };
}

const POST_URL_RE = /https?:\/\/[^"'\\ ]*facebook\.com\/[^"'\\ ]*(?:\/posts\/|\/permalink\/|story_fbid=|pfbid)[^"'\\ ]*/i;

export function parsePagePosts(objs: any[]): FbPost[] {
  const byKey = new Map<string, FbPost>();

  const walk = (node: any, text?: string, url?: string) => {
    if (!node || typeof node !== 'object') return;

    // cập nhật ngữ cảnh text/url theo nhánh
    let curText = text;
    let curUrl = url;
    const msg = node.message?.text || node.title?.text || node.body?.text;
    if (typeof msg === 'string' && msg.length > curText?.length!) curText = msg;
    else if (typeof msg === 'string' && !curText) curText = msg;
    for (const k of ['url', 'wwwURL', 'permalink_url', 'story_permalink_url']) {
      const u = node[k];
      if (typeof u === 'string' && POST_URL_RE.test(u)) curUrl = u;
    }

    // node feedback
    if (node.reaction_count && typeof node.reaction_count === 'object') {
      const { reactions, comments, shares } = readFeedback(node);
      const idFromUrl = curUrl ? (/(pfbid[\w]+|\/posts\/\d+|story_fbid=\d+|\/permalink\/\d+)/.exec(curUrl) || [])[0] : undefined;
      const postId = node.subscription_target_id || node.associated_story_id || idFromUrl;
      const key = curUrl || postId || `${curText?.slice(0, 40)}#${reactions}`;
      if (key && (reactions || comments || shares)) {
        const total = reactions + comments + shares;
        const prev = byKey.get(key);
        if (!prev || total > prev.total) {
          byKey.set(key, {
            postId: typeof postId === 'string' ? postId : undefined,
            url: curUrl,
            text: curText?.replace(/\s+/g, ' ').trim().slice(0, 240),
            reactions,
            comments,
            shares,
            total,
          });
        }
      }
    }

    if (Array.isArray(node)) {
      for (const c of node) walk(c, curText, curUrl);
    } else {
      for (const k of Object.keys(node)) walk(node[k], curText, curUrl);
    }
  };

  for (const o of objs) walk(o);
  return [...byKey.values()];
}
