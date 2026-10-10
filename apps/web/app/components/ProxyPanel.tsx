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

  const selectDead = () => {
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

  // Bulk deletion
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
    <div style={{ maxWidth: 960 }}>
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

      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          margin: '8px 0',
          flexWrap: 'wrap',
        }}
      >
        <button type="button" className="srcbtn" disabled={busy} onClick={add}>
          Thêm proxy
        </button>
        <button type="button" className="srcbtn" disabled={busy} onClick={testAll}>
          Test tất cả ({list.length})
        </button>

        {/* Nút tác vụ hàng loạt */}
        <div
          style={{
            display: 'inline-flex',
            gap: 6,
            alignItems: 'center',
            marginLeft: 'auto',
            flexWrap: 'wrap',
          }}
        >
          {deadProxies.length > 0 && (
            <button
              type="button"
              className="srcbtn"
              disabled={busy}
              onClick={selectDead}
              title="Tích chọn tất cả các dòng proxy Die"
              style={{ fontSize: 13, padding: '7px 12px' }}
            >
              Chọn Die ({deadProxies.length})
            </button>
          )}

          {sel.size > 0 && (
            <>
              <button
                type="button"
                className="srcbtn"
                disabled={busy}
                onClick={clearSel}
                title="Bỏ chọn tất cả"
                style={{ fontSize: 13, padding: '7px 12px' }}
              >
                Bỏ chọn
              </button>
              <button
                type="button"
                className="srcbtn"
                disabled={busy}
                onClick={bulkDelete}
                style={{
                  fontSize: 13,
                  padding: '7px 12px',
                  color: 'var(--danger)',
                  borderColor: 'color-mix(in srgb, var(--danger) 50%, var(--border))',
                  fontWeight: 600,
                }}
              >
                🗑️ Xóa đã chọn ({sel.size})
              </button>
            </>
          )}

          {deadProxies.length > 0 && sel.size === 0 && (
            <button
              type="button"
              className="srcbtn"
              disabled={busy}
              onClick={deleteDead}
              style={{
                fontSize: 13,
                padding: '7px 12px',
                color: 'var(--danger)',
                borderColor: 'color-mix(in srgb, var(--danger) 50%, var(--border))',
                fontWeight: 600,
              }}
              title="Xóa nhanh tất cả proxy Die mà không cần tích chọn thủ công"
            >
              🗑️ Xóa toàn bộ Die ({deadProxies.length})
            </button>
          )}
        </div>
      </div>

      {/* Thống kê & thông báo */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          fontSize: 13,
          margin: '8px 0 12px',
          flexWrap: 'wrap',
          opacity: 0.9,
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
            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>
              Đã chọn: {sel.size}/{list.length}
            </span>
          </>
        )}
        {msg && <span style={{ marginLeft: 6, fontStyle: 'italic' }}>— {msg}</span>}
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
                      style={{ cursor: 'pointer', width: 16, height: 16 }}
                    />
                    <span
                      style={{
                        fontFamily: 'monospace',
                        fontSize: 13,
                        overflowWrap: 'anywhere',
                        fontWeight: isChecked ? 600 : 400,
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
              <th style={{ width: 36, textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = hasPartialSelected;
                  }}
                  onChange={toggleAll}
                  title={isAllSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                  style={{ cursor: 'pointer', width: 15, height: 15 }}
                />
              </th>
              <th>#</th>
              <th>Server / IP</th>
              <th>Loại</th>
              <th>Trạng thái</th>
              <th>Bật</th>
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
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleSel(p.id)}
                      style={{ cursor: 'pointer', width: 15, height: 15 }}
                    />
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
