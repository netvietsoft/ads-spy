'use client';
import { useEffect, useState } from 'react';
import { ShTokenStatus, shSetToken, shClearToken, shTokenStatus } from '../api';

// Kết nối / đổi token ShopHunter (refresh token). Dùng chung ở tab Cài đặt + tab ShopHunter.
export function ShTokenBox() {
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<ShTokenStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { shTokenStatus().then(setStatus).catch(() => {}); }, []);

  async function saveToken() {
    setErr(null);
    try { const st = await shSetToken(token.trim()); setStatus(st); if (st.valid) setToken(''); else setErr('Token không hợp lệ.'); }
    catch (e) { setErr((e as Error).message); }
  }
  async function clearToken() {
    setErr(null);
    try { await shClearToken(); setStatus({ valid: false }); setToken(''); }
    catch (e) { setErr((e as Error).message); }
  }

  return (
    <>
      {!status?.valid && (
        <div className="proxybox">
          <p>Dán ShopHunter <b>refresh token</b> (localStorage key <code>...refreshToken</code>) để bắt đầu:</p>
          <textarea value={token} onChange={(e) => setToken(e.target.value)} rows={2} placeholder="eyJ..." style={{ width: '100%' }} />
          <button className="srcbtn" onClick={saveToken}>Lưu token</button>
        </div>
      )}
      {status?.valid && (
        <div className="savedbanner" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>Đã kết nối ShopHunter: {status.email}</span>
          <button type="button" className="srcbtn" onClick={clearToken}>Đổi token / Thoát</button>
        </div>
      )}
      {err && <div className="err">{err}</div>}
    </>
  );
}
