'use client';
import { useEffect, useState } from 'react';
import { ShProxy, shProxies, shAddProxies, shTestAllProxies, shTestProxy, shUpdateProxy, shDeleteProxy } from '../api';

export function ProxyPanel() {
  const [list, setList] = useState<ShProxy[]>([]);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = () => shProxies().then(setList).catch(() => {});
  useEffect(() => { reload(); }, []);

  const add = async () => {
    if (!text.trim()) return;
    setBusy(true); setMsg('');
    try {
      const r = await shAddProxies(text);
      setMsg(`Đã thêm/cập nhật ${r.added} proxy` + (r.bad.length ? ` · ${r.bad.length} dòng không nhận dạng (bỏ qua)` : ''));
      setText(''); await reload();
    } catch (e) { setMsg('Lỗi: ' + (e as Error).message); }
    setBusy(false);
  };
  const testAll = async () => {
    setBusy(true); setMsg('Đang test tất cả…');
    try { const r = await shTestAllProxies(); setMsg(`Test xong: ${r.live} live / ${r.die} die`); await reload(); }
    catch (e) { setMsg('Lỗi: ' + (e as Error).message); }
    setBusy(false);
  };
  const testOne = async (id: number) => { setMsg('Đang test…'); await shTestProxy(id).catch(() => {}); setMsg(''); reload(); };
  const toggle = async (p: ShProxy) => { await shUpdateProxy(p.id, { enabled: !p.enabled }).catch(() => {}); reload(); };
  const del = async (id: number) => { if (confirm('Xóa proxy này?')) { await shDeleteProxy(id).catch(() => {}); reload(); } };
  const edit = async (p: ShProxy) => {
    const v = prompt('Sửa proxy (host:port:user:pass hoặc socks5://user:pass@host:port):', p.raw);
    if (v == null || !v.trim() || v.trim() === p.raw) return;
    await shDeleteProxy(p.id).catch(() => {});
    await shAddProxies(v.trim()).catch(() => {});
    reload();
  };

  const statusCell = (p: ShProxy) => {
    if (!p.status) return <span style={{ color: '#9ca3af' }}>chưa test</span>;
    if (p.status === 'live') return <span style={{ color: '#16a34a' }}>● Live{p.ping_ms != null ? ` (${p.ping_ms}ms)` : ''}</span>;
    return <span style={{ color: '#e0384f' }}>● Die</span>;
  };

  return (
    <div style={{ maxWidth: 920 }}>
      <h3 style={{ margin: '4px 0' }}>Proxy — crawler Shopify</h3>
      <p style={{ fontSize: 13, opacity: 0.7 }}>
        Dán mỗi dòng 1 proxy: <code>host:port:user:pass</code>, <code>host:port</code>, hoặc <code>socks5://user:pass@host:port</code>.
        Kiểu <code>server=…&amp;secret=…</code> (Shadowsocks/MTProto) KHÔNG hỗ trợ (crawler dùng HTTP-CONNECT).
      </p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
        placeholder={'15.235.177.3:47580:user:pass\nsocks5://user:pass@1.2.3.4:1080'}
        style={{ width: '100%', fontFamily: 'monospace', fontSize: 13, boxSizing: 'border-box' }} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
        <button type="button" className="srcbtn" disabled={busy} onClick={add}>Thêm proxy</button>
        <button type="button" className="srcbtn" disabled={busy} onClick={testAll}>Test tất cả</button>
        {msg && <span style={{ fontSize: 13 }}>{msg}</span>}
      </div>
      <table className="localtbl">
        <thead><tr><th>#</th><th>Server / IP</th><th>Loại</th><th>Trạng thái</th><th>Bật</th><th>Sửa / Xóa</th></tr></thead>
        <tbody>
          {list.map((p, i) => (
            <tr key={p.id}>
              <td>{i + 1}</td>
              <td style={{ fontFamily: 'monospace' }}>{p.host}:{p.port}{p.username ? ` · ${p.username}` : ''}</td>
              <td>{p.type}</td>
              <td>{statusCell(p)}</td>
              <td><input type="checkbox" checked={p.enabled} onChange={() => toggle(p)} title="Bật/Tắt dùng proxy này" /></td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button type="button" className="srcbtn" onClick={() => testOne(p.id)}>Test</button>{' '}
                <button type="button" className="srcbtn" onClick={() => edit(p)}>Sửa</button>{' '}
                <button type="button" className="srcbtn" onClick={() => del(p.id)}>Xóa</button>
              </td>
            </tr>
          ))}
          {!list.length && <tr><td colSpan={6} style={{ textAlign: 'center', opacity: 0.6, padding: 16 }}>Chưa có proxy — dán vào ô trên rồi bấm "Thêm proxy".</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
