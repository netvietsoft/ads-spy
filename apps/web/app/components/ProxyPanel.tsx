'use client';
import { useEffect, useState } from 'react';
import {
  ShProxy,
  shProxies,
  shAddProxies,
  shTestAllProxies,
  shTestProxy,
  shUpdateProxy,
  shDeleteProxy,
  shDeleteProxies,
} from '../api';
import { useIsMobile } from '../useIsMobile';

export function ProxyPanel() {
  const isMobile = useIsMobile(); // ≤760px → mỗi proxy 1 thẻ thay bảng 6 cột
  const [list, setList] = useState<ShProxy[]>([]);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<Set<number>>(new Set());

  const reload = async () => {
    try {
      const data = await shProxies();
      setList(data);
      // Giữ lại các ID đã chọn nếu chúng vẫn còn tồn tại trong danh sách mới
      setSel((prev) => {
        if (!prev.size) return prev;
        const valid = new Set(data.map((p) => p.id));
        const next = new Set<number>();
        for (const id of prev) {
          if (valid.has(id)) next.add(id);
        }
        return next;
      });
    } catch {
      // Bỏ qua lỗi mạng nền
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setMsg('');
    try {
      const r = await shAddProxies(text);
      setMsg(
        `Đã thêm/cập nhật ${r.added} proxy` +
          (r.bad.length ? ` · ${r.bad.length} dòng không nhận dạng (bỏ qua)` : ''),
      );
      setText('');
      await reload();
    } catch (e) {
      setMsg('Lỗi: ' + (e as Error).message);
    }
    setBusy(false);
  };

  const testAll = async () => {
    setBusy(true);
    setMsg('Đang test tất cả…');
    try {
      const r = await shTestAllProxies();
      setMsg(`Test xong: ${r.live} live / ${r.die} die`);
      await reload();
    } catch (e) {
      setMsg('Lỗi: ' + (e as Error).message);
    }
    setBusy(false);
  };

  const testOne = async (id: number) => {
    setMsg('Đang test…');
    await shTestProxy(id).catch(() => {});
    setMsg('');
    reload();
  };

  const toggle = async (p: ShProxy) => {
    await shUpdateProxy(p.id, { enabled: !p.enabled }).catch(() => {});
    reload();
  };

  const del = async (id: number) => {
    if (confirm('Xóa proxy này?')) {
      await shDeleteProxy(id).catch(() => {});
      setSel((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      reload();
    }
  };

  const edit = async (p: ShProxy) => {
    const v = prompt('Sửa proxy (host:port:user:pass hoặc socks5://user:pass@host:port):', p.raw);
    if (v == null || !v.trim() || v.trim() === p.raw) return;
    await shDeleteProxy(p.id).catch(() => {});
    await shAddProxies(v.trim()).catch(() => {});
    reload();
  };

  // Checkbox helpers
  const toggleSel = (id: number) => {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isAllSelected = list.length > 0 && list.every((p) => sel.has(p.id));
  const hasPartialSelected = list.some((p) => sel.has(p.id)) && !isAllSelected;

  const toggleAll = () => {
    if (isAllSelected) {
      setSel(new Set());
    } else {
      setSel(new Set(list.map((p) => p.id)));
    }
  };

  const deadProxies = list.filter((p) => p.status === 'die');
  const liveProxies = list.filter((p) => p.status === 'live');
  const untestedProxies = list.filter((p) => !p.status);

  // Chọn tất cả proxy chết
  const selectAllDead = () => {
    if (!deadProxies.length) {
      setMsg('Không có proxy nào có trạng thái Die.');
      return;
    }
    setSel(new Set(deadProxies.map((p) => p.id)));
    setMsg(`Đã tích chọn ${deadProxies.length} proxy Die.`);
  };

  const clearSel = () => {
    setSel(new Set());
  };

  // Xóa danh sách proxy đã chọn
  const bulkDelete = async () => {
    const ids = Array.from(sel);
    if (!ids.length) return;
    if (!confirm(`Bạn có chắc muốn xóa ${ids.length} proxy đã chọn? Thao tác này không thể hoàn tác.`)) {
      return;
    }
    setBusy(true);
    setMsg(`Đang xóa ${ids.length} proxy...`);
    try {
      const r = await shDeleteProxies(ids);
      setMsg(`Đã xóa thành công ${r.count ?? ids.length} proxy.`);
      setSel(new Set());
      await reload();
    } catch (e) {
      setMsg('Lỗi xóa proxy: ' + (e as Error).message);
    }
    setBusy(false);
  };

  // 1-click xóa sạch toàn bộ proxy Die
  const deleteDead = async () => {
    if (!deadProxies.length) {
      setMsg('Không có proxy nào có trạng thái Die.');
      return;
    }
    if (
      !confirm(
        `Bạn có chắc muốn xóa toàn bộ ${deadProxies.length} proxy Die (chết)? Thao tác này không thể hoàn tác.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setMsg(`Đang xóa ${deadProxies.length} proxy Die...`);
    const deadIds = deadProxies.map((p) => p.id);
    try {
      const r = await shDeleteProxies(deadIds);
      setMsg(`Đã xóa thành công ${r.count ?? deadIds.length} proxy Die.`);
      setSel((prev) => {
        const next = new Set(prev);
        deadIds.forEach((id) => next.delete(id));
        return next;
      });
      await reload();
    } catch (e) {
      setMsg('Lỗi xóa proxy: ' + (e as Error).message);
    }
    setBusy(false);
  };

  const statusCell = (p: ShProxy) => {
    if (!p.status) return <span style={{ color: '#9ca3af' }}>chưa test</span>;
    if (p.status === 'live')
      return (
        <span style={{ color: '#16a34a', fontWeight: 600 }}>
          ● Live{p.ping_ms != null ? ` (${p.ping_ms}ms)` : ''}
        </span>
      );
    return <span style={{ color: '#e0384f', fontWeight: 600 }}>● Die</span>;
  };

  return (
    <div style={{ maxWidth: 980 }}>
      <h3 style={{ margin: '4px 0' }}>Proxy — crawler Shopify</h3>
      <p style={{ fontSize: 13, opacity: 0.7 }}>
        Dán mỗi dòng 1 proxy: <code>host:port:user:pass</code>, <code>host:port</code>, hoặc{' '}
        <code>socks5://user:pass@host:port</code>. Kiểu <code>server=…&amp;secret=…</code> (Shadowsocks/MTProto)
        KHÔNG hỗ trợ (crawler dùng HTTP-CONNECT).
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder={'15.235.177.3:47580:user:pass\nsocks5://user:pass@1.2.3.4:1080'}
        style={{ width: '100%', fontFamily: 'monospace', fontSize: 13, boxSizing: 'border-box' }}
      />

      {/* Toolbar chính */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          margin: '10px 0',
          flexWrap: 'wrap',
        }}
      >
        <button type="button" className="srcbtn" disabled={busy} onClick={add}>
          Thêm proxy
        </button>
        <button type="button" className="srcbtn" disabled={busy} onClick={testAll}>
          Test tất cả ({list.length})
        </button>

        {/* Nút Tick chọn tất cả */}
        {list.length > 0 && (
          <button
            type="button"
            className="srcbtn"
            disabled={busy}
            onClick={toggleAll}
            title={isAllSelected ? 'Bỏ chọn tất cả các dòng' : 'Tích chọn tất cả các dòng proxy'}
            style={{ fontWeight: 600 }}
          >
            {isAllSelected ? '☒ Bỏ chọn tất cả' : `☑️ Tick chọn tất cả (${list.length})`}
          </button>
        )}

        {/* Nút Tick chọn tất cả proxy Die */}
        {deadProxies.length > 0 && (
          <button
            type="button"
            className="srcbtn"
            disabled={busy}
            onClick={selectAllDead}
            title="Tích chọn tất cả các proxy đang có trạng thái Die"
            style={{
              fontWeight: 600,
              color: '#e0384f',
              borderColor: 'color-mix(in srgb, #e0384f 40%, var(--border))',
            }}
          >
            💀 Chọn tất cả Die ({deadProxies.length})
          </button>
        )}

        {/* Nút Xóa các proxy đã chọn - LUÔN HIỂN THỊ */}
        <button
          type="button"
          className="srcbtn"
          disabled={busy || sel.size === 0}
          onClick={bulkDelete}
          style={
            sel.size > 0
              ? {
                  background: '#e0384f',
                  color: '#fff',
                  borderColor: '#e0384f',
                  fontWeight: 700,
                  cursor: 'pointer',
                }
              : {
                  opacity: 0.5,
                  cursor: 'not-allowed',
                }
          }
          title={
            sel.size > 0
              ? `Bấm để xóa ${sel.size} proxy đang được tích chọn`
              : 'Hãy tick chọn các ô ở cột "Chọn xóa" để xóa'
          }
        >
          🗑️ Xóa đã chọn ({sel.size})
        </button>

        {sel.size > 0 && (
          <button
            type="button"
            className="srcbtn"
            disabled={busy}
            onClick={clearSel}
            title="Bỏ chọn các dòng đã tích"
          >
            Bỏ chọn
          </button>
        )}

        {/* Nút 1-click: Xóa toàn bộ proxy Die */}
        {deadProxies.length > 0 && (
          <button
            type="button"
            className="srcbtn"
            disabled={busy}
            onClick={deleteDead}
            style={{
              color: '#e0384f',
              borderColor: 'color-mix(in srgb, #e0384f 50%, var(--border))',
              fontWeight: 600,
              marginLeft: 'auto',
            }}
            title="Bấm để xóa sạch ngay lập tức toàn bộ proxy Die hiện tại"
          >
            🗑️ Xóa toàn bộ proxy Die ({deadProxies.length})
          </button>
        )}
      </div>

      {/* Dòng tóm tắt thống kê & trạng thái */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          fontSize: 13,
          margin: '8px 0 14px',
          padding: '6px 10px',
          background: 'var(--panel-2, rgba(255,255,255,0.04))',
          borderRadius: 8,
          border: '1px solid var(--border)',
          flexWrap: 'wrap',
        }}
      >
        <span>
          Tổng: <b>{list.length}</b>
        </span>
        <span>·</span>
        <span style={{ color: '#16a34a' }}>
          ● Live: <b>{liveProxies.length}</b>
        </span>
        <span>·</span>
        <span style={{ color: '#e0384f' }}>
          ● Die: <b>{deadProxies.length}</b>
        </span>
        {untestedProxies.length > 0 && (
          <>
            <span>·</span>
            <span style={{ color: '#9ca3af' }}>
              Chưa test: <b>{untestedProxies.length}</b>
            </span>
          </>
        )}
        {sel.size > 0 && (
          <>
            <span>·</span>
            <span style={{ color: 'var(--accent)', fontWeight: 700 }}>
              Đang chọn: {sel.size} / {list.length} proxy
            </span>
          </>
        )}
        {msg && <span style={{ marginLeft: 'auto', fontStyle: 'italic', color: 'var(--accent)' }}>{msg}</span>}
      </div>

      {isMobile ? (
        /* Mobile: mỗi proxy 1 thẻ — có checkbox ở đầu thẻ */
        <div className="localcards">
          {list.map((p, i) => {
            const isChecked = sel.has(p.id);
            return (
              <div
                className="fbcard localcard"
                key={p.id}
                style={
                  isChecked
                    ? {
                        border: '1px solid var(--accent)',
                        background: 'color-mix(in srgb, var(--accent) 8%, var(--panel))',
                      }
                    : undefined
                }
              >
                <div
                  className="fbpage"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    alignItems: 'center',
                  }}
                >
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      flex: 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleSel(p.id)}
                      style={{ cursor: 'pointer', width: 18, height: 18 }}
                    />
                    <span
                      style={{
                        fontFamily: 'monospace',
                        fontSize: 13,
                        overflowWrap: 'anywhere',
                        fontWeight: isChecked ? 700 : 400,
                      }}
                    >
                      {i + 1}. {p.host}:{p.port}
                    </span>
                  </label>
                  <label
                    style={{
                      display: 'inline-flex',
                      gap: 4,
                      alignItems: 'center',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      onChange={() => toggle(p)}
                      title="Bật/Tắt dùng proxy này"
                    />{' '}
                    Bật
                  </label>
                </div>
                <div className="fbplat" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <span>{p.type}</span>
                  {p.username ? (
                    <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.username}</span>
                  ) : null}
                  <span>{statusCell(p)}</span>
                </div>
                <div className="fbfoot" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" className="srcbtn" onClick={() => testOne(p.id)}>
                    Test
                  </button>
                  <button type="button" className="srcbtn" onClick={() => edit(p)}>
                    Sửa
                  </button>
                  <button type="button" className="srcbtn" onClick={() => del(p.id)}>
                    Xóa
                  </button>
                </div>
              </div>
            );
          })}
          {!list.length && (
            <p style={{ textAlign: 'center', opacity: 0.6, padding: 16 }}>
              Chưa có proxy — dán vào ô trên rồi bấm "Thêm proxy".
            </p>
          )}
        </div>
      ) : (
        <table className="localtbl">
          <thead>
            <tr>
              <th style={{ width: 110, whiteSpace: 'nowrap' }}>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                  title={isAllSelected ? 'Bỏ chọn tất cả' : 'Tích chọn tất cả'}
                >
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = hasPartialSelected;
                    }}
                    onChange={toggleAll}
                    style={{ cursor: 'pointer', width: 16, height: 16 }}
                  />
                  <span>Chọn xóa</span>
                </label>
              </th>
              <th>#</th>
              <th>Server / IP</th>
              <th>Loại</th>
              <th>Trạng thái</th>
              <th title="Bật/Tắt crawler sử dụng proxy này">Bật crawler</th>
              <th>Sửa / Xóa</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p, i) => {
              const isChecked = sel.has(p.id);
              return (
                <tr
                  key={p.id}
                  style={
                    isChecked
                      ? { background: 'color-mix(in srgb, var(--accent) 12%, transparent)' }
                      : undefined
                  }
                >
                  <td>
                    <label
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '100%',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSel(p.id)}
                        style={{ cursor: 'pointer', width: 16, height: 16 }}
                      />
                    </label>
                  </td>
                  <td>{i + 1}</td>
                  <td style={{ fontFamily: 'monospace' }}>
                    {p.host}:{p.port}
                    {p.username ? ` · ${p.username}` : ''}
                  </td>
                  <td>{p.type}</td>
                  <td>{statusCell(p)}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      onChange={() => toggle(p)}
                      title="Bật/Tắt dùng proxy này"
                      style={{ cursor: 'pointer' }}
                    />
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className="srcbtn" onClick={() => testOne(p.id)}>
                      Test
                    </button>{' '}
                    <button type="button" className="srcbtn" onClick={() => edit(p)}>
                      Sửa
                    </button>{' '}
                    <button type="button" className="srcbtn" onClick={() => del(p.id)}>
                      Xóa
                    </button>
                  </td>
                </tr>
              );
            })}
            {!list.length && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', opacity: 0.6, padding: 16 }}>
                  Chưa có proxy — dán vào ô trên rồi bấm "Thêm proxy".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
