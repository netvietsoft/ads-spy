'use client';
import { useEffect, useState } from 'react';
import { fbSessionStatus, fbSetSession, fbVerifySession } from '../api';

// Đăng nhập Facebook bằng cookie — tách khỏi trang FB Ads, đặt trong Cài đặt (cạnh token ShopHunter).
export function FbCookieBox() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [cookieValid, setCookieValid] = useState<boolean | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [cookie, setCookie] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { fbSessionStatus().then((s) => setLoggedIn(s.loggedIn)).catch(() => {}); }, []);

  async function saveCookie() {
    if (!cookie.trim()) return;
    setErr(null);
    try {
      const s = await fbSetSession(cookie.trim());
      setLoggedIn(s.loggedIn);
      if (s.loggedIn) { setShowAuth(false); setCookie(''); }
      else setErr('Cookie chưa có c_user — dán thiếu, cần cả c_user và xs.');
    } catch (e: any) { setErr(e.message || 'Lỗi lưu cookie'); }
  }
  async function verifyCookie() {
    setVerifying(true);
    try { const v = await fbVerifySession(); setLoggedIn(v.loggedIn); setCookieValid(v.valid); }
    catch { setCookieValid(false); }
    finally { setVerifying(false); }
  }

  return (
    <div>
      <div className="fbauth">
        <span className="authstatus">
          {loggedIn === null ? <span className="pill">…</span>
            : loggedIn ? <span className="pill ok">🔒 Đã đăng nhập FB{cookieValid === false ? ' (cookie hết hạn?)' : ''}</span>
              : <span className="pill off">🔓 Chưa đăng nhập FB</span>}
          {cookieValid === true && <span className="pill ok">✔ Cookie còn hiệu lực</span>}
        </span>
        <span className="fav-btns">
          <button className="ghost" type="button" onClick={verifyCookie} disabled={verifying}>{verifying ? <span className="spinner" /> : 'Kiểm tra cookie'}</button>
          <button className="ghost" type="button" onClick={() => setShowAuth((v) => !v)}>{loggedIn ? 'Đổi cookie' : 'Đăng nhập cookie'}</button>
        </span>
      </div>
      {err && <div className="err" style={{ marginTop: 6 }}>{err}</div>}
      {showAuth && (
        <div className="fbauth-box">
          <p className="hint" style={{ marginTop: 0 }}>
            Dán 1 trong 2: (a) chuỗi <code>document.cookie</code> (F12 → Console), hoặc (b) nội dung file <code>cookies.txt</code> (định dạng Netscape).
            Cần có <code>c_user</code> và <code>xs</code>. Nên dùng <b>nick phụ</b>.
          </p>
          <textarea className="fbauth-ta" value={cookie} onChange={(e) => setCookie(e.target.value)} placeholder="datr=...; sb=...; c_user=100...; xs=...; fr=..." rows={3} />
          <button className="primary" type="button" onClick={saveCookie}>Lưu cookie</button>
        </div>
      )}
    </div>
  );
}
