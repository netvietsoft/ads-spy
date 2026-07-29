// ==UserScript==
// @name         AITDK traffic → aff
// @description  Gom khối traffic mà extension AITDK đã render trên trang kết quả Google, gửi về /api/aff/traffic
// @version      1.0
// @match        https://www.google.com/search*
// @match        https://www.google.com.vn/search*
// @grant        GM_xmlhttpRequest
// @connect      localhost
// ==/UserScript==

// Chạy trong browser thật, nơi extension AITDK đã hiển thị sẵn số liệu — script chỉ đọc DOM có sẵn
// rồi gửi nguyên văn text về endpoint dán tay. Backend parse bằng parseTrafficPaste như khi dán tay.
//
// TOKEN: endpoint /api/aff/traffic nằm sau AuthGuard, cookie phiên là httpOnly + SameSite=Lax nên request
// từ google.com KHÔNG kèm được cookie → phải gửi Bearer token. Lấy 1 lần: đăng nhập app tại localhost:3101,
// mở DevTools → Application → Cookies → copy giá trị cookie `gas_session`, dán vào TOKEN dưới đây.
// Token sống 30 ngày (SESSION_TTL_DAYS), hết hạn thì lấy lại.
(function () {
  'use strict';

  const TOKEN = '';   // <-- dán giá trị cookie gas_session vào đây
  const AUTO = true;  // true = tự đẩy khi extension render xong; false = chỉ đẩy khi bấm nút
  const API = 'http://localhost:3100/api/aff/traffic';
  const METRICS = '.aitdk-site-metrics';
  const HAS_LABEL = /Monthly Visits|Bounce Rate|Visit Duration|Global Rank/i;
  const sent = new Set();

  function domainOf(el) {
    // Đi ngược lên tổ tiên tìm link kết quả đầu tiên — mỗi khối metrics nằm trong 1 kết quả Google.
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const a = n.querySelector('a[href^="http"]');
      if (!a) continue;
      try {
        return new URL(a.href).hostname.replace(/^www\./, '').toLowerCase();
      } catch { /* href rác, thử tổ tiên tiếp */ }
    }
    return null;
  }

  function collect() {
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll(METRICS)) {
      const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (!HAS_LABEL.test(text)) continue;      // chưa load xong hoặc đổi layout → bỏ, đừng gửi rác
      const web = domainOf(el);
      if (!web || seen.has(web) || sent.has(web)) continue;
      seen.add(web);
      out.push({ web, text });
    }
    return out;
  }

  function post(item) {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: API,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
        data: JSON.stringify(item),
        onload: (r) => resolve(r.status >= 200 && r.status < 300),
        onerror: () => resolve(false),
        ontimeout: () => resolve(false),
        timeout: 15000,
      });
    });
  }

  const btn = document.createElement('button');
  btn.style.cssText =
    'position:fixed;right:16px;bottom:16px;z-index:99999;padding:10px 14px;border:0;border-radius:8px;' +
    'background:#1a73e8;color:#fff;font:600 13px system-ui;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3)';
  document.body.appendChild(btn);

  let busy = false;
  async function flush(items) {
    if (busy || !items.length) return;
    busy = true;
    let ok = 0;
    for (const it of items) {
      if (await post(it)) { ok++; sent.add(it.web); }
    }
    btn.textContent = `Đã gửi ${ok}/${items.length}`;
    busy = false;
  }

  function refresh() {
    const n = collect().length;
    if (busy) return;
    btn.textContent = n ? `Gửi ${n} traffic → aff` : (AUTO ? 'Đang theo dõi…' : 'Chưa có số liệu AITDK');
    btn.disabled = n === 0;
    btn.style.opacity = n ? '1' : '.6';
  }

  btn.addEventListener('click', () => flush(collect()));

  // Extension render bất đồng bộ (SSE) → theo dõi DOM. AUTO: gom vài trăm ms rồi tự đẩy số mới.
  let timer = null;
  new MutationObserver(() => {
    refresh();
    if (!AUTO) return;
    clearTimeout(timer);
    timer = setTimeout(() => flush(collect()), 800);
  }).observe(document.body, { childList: true, subtree: true });
  refresh();
})();
