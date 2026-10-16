'use client';
import { useEffect, useState } from 'react';
import {
  adminUsers,
  adminUpdateUser,
  adminUserAction,
  adminModules,
  adminGrantPlan,
  adminUserSubs,
  adminRevokeSub,
  adminCreateUser,
  adminSetUserPassword,
  adminDeleteUser,
  adminUserSessions,
  adminRevokeUserSessions,
} from '../api';
import { useIsMobile } from '../useIsMobile';

const fmt = (d?: string) => (d ? new Date(d).toLocaleDateString('vi-VN') : '');
const fmtTime = (d?: string) => (d ? new Date(d).toLocaleString('vi-VN') : '—');

function parseDevice(ua?: string) {
  if (!ua) return 'Không rõ thiết bị';
  let os = 'Thiết bị';
  if (/windows/i.test(ua)) os = '💻 Windows';
  else if (/macintosh|mac os/i.test(ua)) os = '💻 macOS';
  else if (/android/i.test(ua)) os = '📱 Android';
  else if (/iphone|ipad|ipod/i.test(ua)) os = '📱 iOS';
  else if (/linux/i.test(ua)) os = '🐧 Linux';

  let browser = '';
  if (/edg/i.test(ua)) browser = 'Edge';
  else if (/chrome/i.test(ua)) browser = 'Chrome';
  else if (/firefox/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua)) browser = 'Safari';

  return browser ? `${os} · ${browser}` : os;
}

function generateRandomPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  let res = '';
  for (let i = 0; i < 12; i++) {
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return res;
}

export function UsersAdminPanel() {
  const isMobile = useIsMobile();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const [edit, setEdit] = useState<any>(null);
  const [create, setCreate] = useState<{
    email: string;
    password: string;
    name: string;
    phone: string;
    role: string;
    status: string;
    showPw: boolean;
  } | null>(null);

  const [sessionsModal, setSessionsModal] = useState<{
    user: any;
    loading: boolean;
    data: any;
  } | null>(null);

  const [grant, setGrant] = useState<any>(null);
  const [subs, setSubs] = useState<any>(null);
  const [mods, setMods] = useState<any[]>([]);

  useEffect(() => {
    adminModules().then(setMods).catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      setData(await adminUsers({ search, page }));
    } catch (e: any) {
      setErr(e.message || 'Lỗi khi tải dữ liệu người dùng');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (id: number, action: 'ban' | 'disable' | 'activate') => {
    const label = action === 'ban' ? 'khóa vĩnh viễn (Ban)' : action === 'disable' ? 'tạm ngưng tài khoản' : 'kích hoạt lại';
    if (!confirm(`Bạn có chắc chắn muốn ${label} người dùng này?`)) return;
    try {
      await adminUserAction(id, action);
      load();
    } catch (e: any) {
      alert(e.message);
    }
  };

  // Xóa hẳn luôn người dùng khỏi cơ sở dữ liệu
  const doHardDelete = async (id: number, email: string) => {
    const cf = prompt(
      `CẢNH BÁO: Bạn sắp XÓA VĨNH VIỄN người dùng:\n${email}\n\nToàn bộ dữ liệu, gói cước, phiên đăng nhập sẽ bị xóa hoàn toàn khỏi cơ sở dữ liệu và KHÔNG THỂ KHÔI PHỤC.\n\nNhập chữ "XOA" để xác nhận:`
    );
    if (!cf) return;
    if (cf.trim().toUpperCase() !== 'XOA' && cf.trim().toUpperCase() !== 'DELETE') {
      alert('Chưa nhập đúng chữ "XOA". Thao tác xóa đã bị hủy.');
      return;
    }
    try {
      await adminDeleteUser(id);
      alert(`Đã xóa hẳn người dùng ${email}`);
      load();
    } catch (e: any) {
      alert(e.message || 'Lỗi khi xóa người dùng');
    }
  };

  // Đổi mật khẩu
  const changePassword = async (id: number, email: string) => {
    const p = prompt(`Mật khẩu mới cho ${email} (tối thiểu 8 ký tự):`);
    if (p == null) return;
    if (p.trim().length < 8) {
      alert('Mật khẩu tối thiểu 8 ký tự.');
      return;
    }
    try {
      await adminSetUserPassword(id, p.trim());
      alert(`Đã đổi mật khẩu cho ${email}. Mọi phiên đăng nhập cũ của user này đã bị thu hồi.`);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const saveEdit = async () => {
    try {
      await adminUpdateUser(edit.id, {
        name: edit.name,
        phone: edit.phone,
        role: edit.role,
        status: edit.status,
      });
      setEdit(null);
      load();
    } catch (e: any) {
      alert(e.message);
    }
  };

  // Tạo người dùng mới
  const doCreate = async () => {
    if (!create) return;
    const email = (create.email || '').trim();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      alert('Vui lòng nhập email hợp lệ');
      return;
    }
    if (!create.password || create.password.length < 8) {
      alert('Mật khẩu tối thiểu 8 ký tự');
      return;
    }
    try {
      await adminCreateUser({
        email,
        password: create.password,
        name: create.name?.trim() || undefined,
        phone: create.phone?.trim() || undefined,
        role: create.role,
        status: create.status,
      });
      alert(`Đã tạo thành công người dùng: ${email}`);
      setCreate(null);
      load();
    } catch (e: any) {
      alert(e.message || 'Lỗi tạo user');
    }
  };

  // Mở modal kiểm tra các IP người dùng đang dùng
  const openSessions = async (u: any) => {
    setSessionsModal({ user: u, loading: true, data: null });
    try {
      const res = await adminUserSessions(u.id);
      setSessionsModal({ user: u, loading: false, data: res });
    } catch (e: any) {
      alert(e.message || 'Không tải được danh sách phiên của người dùng');
      setSessionsModal(null);
    }
  };

  // Thu hồi tất cả phiên của người dùng (buộc logout từ xa)
  const doRevokeAll = async (userId: number, email: string) => {
    if (
      !confirm(
        `Bạn có chắc chắn muốn thu hồi toàn bộ phiên đăng nhập của ${email}?\nNgười dùng sẽ bị đăng xuất ngay lập tức khỏi mọi thiết bị và IP.`
      )
    )
      return;
    try {
      await adminRevokeUserSessions(userId);
      alert(`Đã thu hồi tất cả phiên của ${email}`);
      const res = await adminUserSessions(userId);
      setSessionsModal((prev) => (prev ? { ...prev, data: res } : null));
      load();
    } catch (e: any) {
      alert(e.message || 'Lỗi khi thu hồi phiên');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 style={{ margin: '10px 0' }}>Quản lý Người dùng</h2>
          <span style={{ fontSize: 13, color: '#64748b' }}>
            {data ? `${data.total} tài khoản` : ''}
          </span>
        </div>
        <button
          className="primary"
          onClick={() =>
            setCreate({
              email: '',
              password: generateRandomPassword(),
              name: '',
              phone: '',
              role: 'user',
              status: 'active',
              showPw: true,
            })
          }
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}
        >
          <span>+</span> Bổ sung người dùng
        </button>
      </div>

      <form className="searchbar" onSubmit={(e) => { e.preventDefault(); setPage(1); load(); }}>
        <input
          value={search}
          placeholder="Tìm theo email, tên, số điện thoại…"
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="primary" disabled={loading}>{loading ? '…' : 'Tìm'}</button>
      </form>

      {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}

      {data && (
        <>
          {isMobile ? (
            /* Mobile View: Thẻ từng user */
            <div className="localcards" style={{ marginTop: 12 }}>
              {data.items.map((u: any) => (
                <div className="fbcard localcard" key={u.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="fbpage" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{u.email}</span>
                      {u.name && <div style={{ fontSize: 12, color: '#64748b' }}>{u.name}</div>}
                    </div>
                    <span className="badge-local">{u.role}</span>
                  </div>

                  <div className="fbplat" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 13 }}>
                    {u.phone ? <span><b>ĐT:</b> {u.phone}</span> : null}
                    <span>
                      <b>Trạng thái:</b>{' '}
                      <span style={{
                        color: u.status === 'active' ? '#16a34a' : u.status === 'banned' ? '#dc2626' : '#ea580c',
                        fontWeight: 600
                      }}>
                        {u.status}
                      </span>
                    </span>
                    <span><b>ĐK:</b> {fmt(u.createdAt)}</span>
                  </div>

                  {/* Thông tin IP & Trạng thái Online */}
                  <div style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: 'rgba(0,0,0,0.03)',
                    fontSize: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span><b>IP gần nhất:</b> <code style={{ color: '#0284c7' }}>{u.lastLoginIp || 'Chưa đăng nhập'}</code></span>
                      {u.activeSessionsCount > 0 ? (
                        <span style={{
                          background: 'rgba(34, 197, 94, 0.15)',
                          color: '#16a34a',
                          padding: '1px 6px',
                          borderRadius: 4,
                          fontWeight: 600,
                          fontSize: 11
                        }}>
                          ● Online ({u.activeSessionsCount})
                        </span>
                      ) : (
                        <span style={{ color: '#94a3b8', fontSize: 11 }}>Offline</span>
                      )}
                    </div>
                    {u.activeIps && u.activeIps.length > 0 && (
                      <div style={{ color: '#475569', fontSize: 11 }}>
                        <b>IP đang kết nối:</b> {u.activeIps.join(', ')}
                      </div>
                    )}
                  </div>

                  <div className="fbfoot" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                    <button className="ghost" onClick={() => openSessions(u)} title="Xem chi tiết các IP và thiết bị">🌐 Check IP</button>
                    <button className="ghost" onClick={() => setEdit({ ...u })}>Sửa</button>
                    <button className="ghost" onClick={() => changePassword(u.id, u.email)}>Đổi MK</button>
                    {u.status !== 'banned' && <button className="ghost" onClick={() => act(u.id, 'ban')}>Ban</button>}
                    {u.status !== 'disabled' && <button className="ghost" onClick={() => act(u.id, 'disable')}>Khóa</button>}
                    {u.status !== 'active' && <button className="ghost" onClick={() => act(u.id, 'activate')}>Kích hoạt</button>}
                    <button
                      className="ghost"
                      onClick={() => doHardDelete(u.id, u.email)}
                      style={{ color: '#ef4444', borderColor: '#fca5a5' }}
                      title="Xóa vĩnh viễn khỏi cơ sở dữ liệu"
                    >
                      🗑️ Xóa hẳn
                    </button>
                  </div>
                </div>
              ))}
              {!data.items.length && <p className="hint">Không tìm thấy người dùng nào.</p>}
            </div>
          ) : (
            /* Desktop View: Bảng đầy đủ */
            <div style={{ overflowX: 'auto', marginTop: 12 }}>
              <table className="localtbl" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Người dùng / Email</th>
                    <th>Điện thoại</th>
                    <th>Role</th>
                    <th>Trạng thái</th>
                    <th>IP & Hoạt động</th>
                    <th>Ngày ĐK</th>
                    <th style={{ textAlign: 'right' }}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((u: any) => (
                    <tr key={u.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{u.email}</div>
                        {u.name && <div style={{ fontSize: 12, color: '#64748b' }}>{u.name}</div>}
                      </td>
                      <td>{u.phone || '—'}</td>
                      <td><span className="badge-local">{u.role}</span></td>
                      <td>
                        <span style={{
                          color: u.status === 'active' ? '#16a34a' : u.status === 'banned' ? '#dc2626' : '#ea580c',
                          fontWeight: 600
                        }}>
                          {u.status}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <code style={{ fontSize: 12, color: '#0284c7', background: '#f0f9ff', padding: '1px 5px', borderRadius: 4 }}>
                              {u.lastLoginIp || '—'}
                            </code>
                            {u.activeSessionsCount > 0 ? (
                              <span style={{
                                background: 'rgba(34, 197, 94, 0.15)',
                                color: '#16a34a',
                                padding: '1px 6px',
                                borderRadius: 4,
                                fontWeight: 600,
                                fontSize: 11
                              }}>
                                ● Online ({u.activeSessionsCount})
                              </span>
                            ) : null}
                          </div>
                          {u.lastLoginAt && (
                            <span style={{ fontSize: 11, color: '#94a3b8' }}>
                              Đăng nhập: {fmtTime(u.lastLoginAt)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ fontSize: 13 }}>{fmt(u.createdAt)}</td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <button
                          className="ghost"
                          onClick={() => openSessions(u)}
                          style={{ marginRight: 4 }}
                          title="Xem chi tiết các địa chỉ IP và phiên đăng nhập"
                        >
                          🌐 Check IP
                        </button>
                        <button className="ghost" onClick={() => setEdit({ ...u })} style={{ marginRight: 4 }}>Sửa</button>
                        <button className="ghost" onClick={() => changePassword(u.id, u.email)} style={{ marginRight: 4 }}>Đổi MK</button>
                        {u.status !== 'banned' && <button className="ghost" onClick={() => act(u.id, 'ban')} style={{ marginRight: 4 }}>Ban</button>}
                        {u.status !== 'disabled' && <button className="ghost" onClick={() => act(u.id, 'disable')} style={{ marginRight: 4 }}>Khóa</button>}
                        {u.status !== 'active' && <button className="ghost" onClick={() => act(u.id, 'activate')} style={{ marginRight: 4 }}>Mở</button>}
                        <button
                          className="ghost"
                          onClick={() => doHardDelete(u.id, u.email)}
                          style={{ color: '#ef4444', borderColor: '#fca5a5' }}
                          title="Xóa vĩnh viễn người dùng khỏi cơ sở dữ liệu"
                        >
                          🗑️ Xóa hẳn
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!data.items.length && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '24px 0', color: '#64748b' }}>
                        Không có người dùng nào.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Phân trang */}
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
            <button className="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Trang trước</button>
            <span style={{ fontSize: 13, color: '#475569' }}>
              Trang {data.page} / {Math.max(1, Math.ceil(data.total / data.pageSize))} · Tổng {data.total} user
            </span>
            <button className="ghost" disabled={page * data.pageSize >= data.total} onClick={() => setPage((p) => p + 1)}>Trang sau →</button>
          </div>
        </>
      )}

      {/* Modal: Bổ sung người dùng */}
      {create && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            backdropFilter: 'blur(2px)',
          }}
          onClick={() => setCreate(null)}
        >
          <div
            style={{
              background: '#fff',
              padding: 24,
              borderRadius: 14,
              width: 440,
              maxWidth: '92vw',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>Bổ sung người dùng mới</h3>
              <button className="ghost" onClick={() => setCreate(null)} style={{ border: 'none', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Email đăng nhập <span style={{ color: '#ef4444' }}>*</span></label>
              <input
                placeholder="user@example.com"
                type="email"
                value={create.email}
                onChange={(e) => setCreate({ ...create, email: e.target.value })}
                style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Mật khẩu <span style={{ color: '#ef4444' }}>*</span> (≥8 ký tự)</label>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setCreate({ ...create, password: generateRandomPassword() })}
                  style={{ fontSize: 11, padding: '2px 8px', color: '#2563eb' }}
                >
                  ⚡ Tạo ngẫu nhiên
                </button>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type={create.showPw ? 'text' : 'password'}
                  placeholder="Mật khẩu bảo mật"
                  value={create.password}
                  onChange={(e) => setCreate({ ...create, password: e.target.value })}
                  style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1' }}
                />
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setCreate({ ...create, showPw: !create.showPw })}
                  style={{ padding: '0 10px', fontSize: 12 }}
                  title="Hiện/Ẩn mật khẩu"
                >
                  {create.showPw ? 'Ẩn' : 'Hiện'}
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Họ và tên</label>
                <input
                  placeholder="Nguyễn Văn A"
                  value={create.name}
                  onChange={(e) => setCreate({ ...create, name: e.target.value })}
                  style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Số điện thoại</label>
                <input
                  placeholder="0912345678"
                  value={create.phone}
                  onChange={(e) => setCreate({ ...create, phone: e.target.value })}
                  style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Phân quyền</label>
                <select
                  value={create.role}
                  onChange={(e) => setCreate({ ...create, role: e.target.value })}
                  style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1' }}
                >
                  <option value="user">User (Người dùng thường)</option>
                  <option value="manager">Manager (Quản lý)</option>
                  <option value="admin">Admin (Quản trị viên)</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Trạng thái</label>
                <select
                  value={create.status}
                  onChange={(e) => setCreate({ ...create, status: e.target.value })}
                  style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1' }}
                >
                  <option value="active">Active (Hoạt động ngay)</option>
                  <option value="disabled">Disabled (Tạm ngưng)</option>
                  <option value="banned">Banned (Bị khóa)</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="ghost" onClick={() => setCreate(null)}>Hủy</button>
              <button className="primary" onClick={doCreate} style={{ fontWeight: 600 }}>Tạo người dùng</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Check các IP & Chi tiết phiên đăng nhập */}
      {sessionsModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            backdropFilter: 'blur(2px)',
          }}
          onClick={() => setSessionsModal(null)}
        >
          <div
            style={{
              background: '#fff',
              padding: 24,
              borderRadius: 14,
              width: 680,
              maxWidth: '94vw',
              maxHeight: '90vh',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>
                  Kiểm tra IP & Thiết bị đang dùng
                </h3>
                <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
                  Tài khoản: <b>{sessionsModal.user.email}</b> {sessionsModal.user.name ? `(${sessionsModal.user.name})` : ''}
                </div>
              </div>
              <button className="ghost" onClick={() => setSessionsModal(null)} style={{ border: 'none', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>

            {sessionsModal.loading ? (
              <div style={{ textAlign: 'center', padding: '30px 0', color: '#64748b' }}>Đang tải lịch sử phiên và IP…</div>
            ) : sessionsModal.data ? (
              <>
                {/* Khối tổng quan IP */}
                <div style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: 14,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    <div>
                      <span style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>IP gần nhất:</span>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#0284c7', marginTop: 2 }}>
                        {sessionsModal.data.user.lastLoginIp || 'Chưa ghi nhận IP'}
                      </div>
                    </div>

                    <div>
                      <span style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Thời gian gần nhất:</span>
                      <div style={{ fontSize: 13, color: '#334155', marginTop: 2 }}>
                        {fmtTime(sessionsModal.data.user.lastLoginAt)}
                      </div>
                    </div>

                    <div>
                      <span style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Số IP đang online:</span>
                      <div style={{ fontSize: 15, fontWeight: 700, color: sessionsModal.data.activeIps?.length ? '#16a34a' : '#94a3b8', marginTop: 2 }}>
                        {sessionsModal.data.activeIps?.length || 0} IP
                      </div>
                    </div>
                  </div>

                  {/* Danh sách các IP đang online */}
                  {sessionsModal.data.activeIps && sessionsModal.data.activeIps.length > 0 && (
                    <div style={{ marginTop: 6, paddingTop: 8, borderTop: '1px dashed #cbd5e1' }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>Các địa chỉ IP đang hoạt động:</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                        {sessionsModal.data.activeIps.map((ip: string) => (
                          <span
                            key={ip}
                            style={{
                              background: '#dcfce7',
                              color: '#15803d',
                              border: '1px solid #bbf7d0',
                              padding: '2px 8px',
                              borderRadius: 6,
                              fontSize: 12,
                              fontFamily: 'monospace',
                              fontWeight: 600,
                            }}
                          >
                            ● {ip}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Bảng chi tiết phiên */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: '#1e293b' }}>
                      Lịch sử phiên đăng nhập ({sessionsModal.data.sessions?.length || 0})
                    </span>
                    <button
                      className="ghost"
                      onClick={() => doRevokeAll(sessionsModal.user.id, sessionsModal.user.email)}
                      style={{ color: '#ef4444', borderColor: '#fca5a5', fontSize: 12, padding: '4px 10px' }}
                      title="Thu hồi tất cả phiên để đăng xuất tài khoản này khỏi toàn bộ IP"
                    >
                      🚫 Đăng xuất khỏi tất cả IP & thiết bị
                    </button>
                  </div>

                  <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                    <table className="localtbl" style={{ width: '100%', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: '#f8fafc' }}>
                          <th>Địa chỉ IP</th>
                          <th>Trạng thái</th>
                          <th>Thiết bị & Trình duyệt</th>
                          <th>Thời gian kết nối</th>
                          <th>Hết hạn</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sessionsModal.data.sessions.map((s: any) => (
                          <tr key={s.id}>
                            <td>
                              <code style={{ fontFamily: 'monospace', fontWeight: 600, color: '#0369a1' }}>
                                {s.ip}
                              </code>
                            </td>
                            <td>
                              {s.isActive ? (
                                <span style={{
                                  background: '#dcfce7',
                                  color: '#15803d',
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                  fontWeight: 600,
                                  fontSize: 11
                                }}>
                                  ● Đang online
                                </span>
                              ) : (
                                <span style={{ color: '#94a3b8', fontSize: 11 }}>
                                  {s.revokedAt ? 'Đã thu hồi' : 'Hết hạn'}
                                </span>
                              )}
                            </td>
                            <td>
                              <div style={{ fontWeight: 500 }}>{parseDevice(s.userAgent)}</div>
                              <div style={{ fontSize: 10, color: '#94a3b8', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.userAgent}>
                                {s.userAgent}
                              </div>
                            </td>
                            <td>{fmtTime(s.createdAt)}</td>
                            <td>{fmtTime(s.expiresAt)}</td>
                          </tr>
                        ))}
                        {!sessionsModal.data.sessions.length && (
                          <tr>
                            <td colSpan={5} style={{ textAlign: 'center', padding: '16px 0', color: '#64748b' }}>
                              Chưa có phiên đăng nhập nào được ghi nhận.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                  <button className="ghost" onClick={() => setSessionsModal(null)}>Đóng</button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* Modal: Sửa thông tin user */}
      {edit && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setEdit(null)}>
          <div style={{ background: '#fff', padding: 22, borderRadius: 12, width: 340, display: 'flex', flexDirection: 'column', gap: 10 }} onClick={(e) => e.stopPropagation()}>
            <b style={{ fontSize: 16 }}>Sửa thông tin: {edit.email}</b>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, color: '#64748b' }}>Họ và tên</label>
              <input placeholder="Tên" value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, color: '#64748b' }}>Số điện thoại</label>
              <input placeholder="Điện thoại" value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, color: '#64748b' }}>Role</label>
              <select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
                <option value="user">user</option>
                <option value="manager">manager</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, color: '#64748b' }}>Trạng thái</label>
              <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                <option value="active">active</option>
                <option value="banned">banned</option>
                <option value="disabled">disabled</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
              <button className="ghost" onClick={() => setEdit(null)}>Hủy</button>
              <button className="primary" onClick={saveEdit}>Lưu thay đổi</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Cấp gói (giữ lại theo cấu trúc dự án) */}
      {grant && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setGrant(null)}>
          <div style={{ background: '#fff', padding: 20, borderRadius: 12, width: 320, display: 'flex', flexDirection: 'column', gap: 10 }} onClick={(e) => e.stopPropagation()}>
            <b>Cấp gói cho {grant.email}</b>
            <select value={grant.moduleKey} onChange={(e) => setGrant({ ...grant, moduleKey: e.target.value })}>
              {mods.map((m) => <option key={m.key} value={m.key}>{m.key}</option>)}
            </select>
            <input placeholder="tier (basic/pro/premium)" value={grant.tier} onChange={(e) => setGrant({ ...grant, tier: e.target.value })} />
            <select value={grant.cycle} onChange={(e) => setGrant({ ...grant, cycle: e.target.value })}>
              <option value="monthly">monthly</option>
              <option value="yearly">yearly</option>
            </select>
            <input placeholder="trial (ngày, tùy chọn)" value={grant.trialDays} onChange={(e) => setGrant({ ...grant, trialDays: e.target.value })} />
            <input placeholder="ghi chú" value={grant.note} onChange={(e) => setGrant({ ...grant, note: e.target.value })} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="ghost" onClick={() => setGrant(null)}>Hủy</button>
              <button className="primary" onClick={async () => {
                try {
                  await adminGrantPlan({
                    userId: grant.userId,
                    moduleKey: grant.moduleKey,
                    tier: grant.tier,
                    cycle: grant.cycle,
                    trialDays: grant.trialDays ? Number(grant.trialDays) : undefined,
                    note: grant.note || undefined,
                  });
                  setGrant(null);
                  load();
                } catch (e: any) {
                  alert(e.message);
                }
              }}>Cấp</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Gói của user (giữ lại theo cấu trúc dự án) */}
      {subs && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setSubs(null)}>
          <div style={{ background: '#fff', padding: 20, borderRadius: 12, width: 380, display: 'flex', flexDirection: 'column', gap: 8 }} onClick={(e) => e.stopPropagation()}>
            <b>Gói của {subs.email}</b>
            {subs.items.length === 0 && <div>Chưa có gói.</div>}
            {subs.items.map((s: any) => (
              <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span>{s.moduleKey}/{s.tier} · {s.cycle} · {s.status} · hết hạn {s.expiresAt ? new Date(s.expiresAt).toLocaleDateString('vi-VN') : ''}</span>
                {s.status === 'active' && (
                  <button className="ghost" onClick={async () => {
                    try {
                      await adminRevokeSub(s.id);
                      setSubs({ ...subs, items: await adminUserSubs(subs.userId) });
                      load();
                    } catch (e: any) {
                      alert(e.message);
                    }
                  }}>Thu hồi</button>
                )}
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="ghost" onClick={() => setSubs(null)}>Đóng</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
