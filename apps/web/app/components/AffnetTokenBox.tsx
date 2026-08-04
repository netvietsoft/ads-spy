'use client';
import { useEffect, useState } from 'react';
import { affNets, affNetTokenStatus, affNetSetToken, affNetClearToken, AffNetRow, AffNetTokenStatus } from '../api';

// Token đăng nhập cho từng net affiliate. Một số net (goaffpro.com…) chỉ cho xem danh sách dự án SAU KHI
// đăng nhập, nên job quét cần token riêng của net đó. Cùng kiểu khối với ShTokenBox/FbCookieBox.
export function AffnetTokenBox() {
  const [nets, setNets] = useState<AffNetRow[]>([]);
  const [net, setNet] = useState('');
  const [kind, setKind] = useState<'bearer' | 'cookie'>('bearer');
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<AffNetTokenStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { affNets().then((r) => { setNets(r); if (r[0] && !net) setNet(r[0].net); }).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Đổi net → nạp lại trạng thái token của net đó (mỗi net 1 token riêng).
  useEffect(() => {
    if (!net) { setStatus(null); return; }
    setMsg(null); setErr(null);
    affNetTokenStatus(net).then(setStatus).catch(() => setStatus(null));
  }, [net]);

  const save = async () => {
    if (!net || !token.trim() || busy) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      await affNetSetToken(net, token.trim(), kind);
      setToken('');
      setStatus(await affNetTokenStatus(net));
      setMsg(`Đã lưu token cho ${net}`);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const clear = async () => {
    if (!net || busy) return;
    if (!confirm(`Xoá token của ${net}?`)) return;
    setBusy(true); setErr(null); setMsg(null);
    try { await affNetClearToken(net); setStatus(await affNetTokenStatus(net)); setMsg(`Đã xoá token của ${net}`); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="proxybox">
      <p style={{ marginTop: 0 }}>
        <b>Token net affiliate</b> — dùng cho net phải <b>đăng nhập</b> mới xem được dự án (vd{' '}
        <code>goaffpro.com</code> chỉ hiện danh sách store ở <code>/affiliate/stores/search</code>).
        Token lưu riêng theo từng net, job quét sẽ tự gắn vào request.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <select className="fbselect" value={net} onChange={(e) => setNet(e.target.value)} disabled={busy}>
          {nets.length === 0 && <option value="">(chưa có net nào — thêm ở tab Affiliate Nets)</option>}
          {nets.map((n) => <option key={n.net} value={n.net}>{n.net}</option>)}
        </select>
        <select className="fbselect" value={kind} onChange={(e) => setKind(e.target.value as 'bearer' | 'cookie')} disabled={busy}
                title="bearer = header Authorization · cookie = chuỗi Cookie của phiên đăng nhập">
          <option value="bearer">Bearer token</option>
          <option value="cookie">Cookie phiên</option>
        </select>
        {status?.has && <span className="hint" style={{ margin: 0 }}>đang có: {status.preview} ({status.kind})</span>}
        {status && !status.has && <span className="hint" style={{ margin: 0 }}>chưa có token</span>}
      </div>
      <textarea rows={2} style={{ width: '100%' }} value={token} disabled={busy || !net}
        placeholder={kind === 'bearer' ? 'eyJ… (lấy ở DevTools → Application → Local Storage)' : 'ten=gia_tri; ten2=gia_tri2 (DevTools → Network → request header Cookie)'}
        onChange={(e) => setToken(e.target.value)} />
      <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        <button className="srcbtn active" onClick={save} disabled={busy || !net || !token.trim()}>Lưu token</button>
        {status?.has && <button className="srcbtn" onClick={clear} disabled={busy}>Xoá token</button>}
      </div>
      {msg && <div className="savedbanner" style={{ marginTop: 8 }}>{msg}</div>}
      {err && <div className="err">{err}</div>}
    </div>
  );
}
