'use client';
import { useEffect, useState } from 'react';
import { adminUsers, adminUpdateUser, adminUserAction, adminModules, adminGrantPlan, adminUserSubs, adminRevokeSub } from '../api';

const usd = (c?: number | null) => (c == null ? '—' : `$${(c / 100).toFixed(2)}`);
const fmt = (d?: string) => (d ? new Date(d).toLocaleDateString('vi-VN') : '');

export function UsersAdminPanel() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<any>(null);
  const [grant, setGrant] = useState<any>(null);
  const [subs, setSubs] = useState<any>(null);
  const [mods, setMods] = useState<any[]>([]);
  useEffect(() => { adminModules().then(setMods).catch(() => {}); }, []);

  const load = async () => {
    setLoading(true); setErr('');
    try { setData(await adminUsers({ search, page })); } catch (e: any) { setErr(e.message || 'Lỗi'); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (id: number, action: 'ban' | 'disable' | 'activate') => {
    try { await adminUserAction(id, action); load(); } catch (e: any) { alert(e.message); }
  };
  const saveEdit = async () => {
    try { await adminUpdateUser(edit.id, { name: edit.name, phone: edit.phone, role: edit.role, status: edit.status }); setEdit(null); load(); }
    catch (e: any) { alert(e.message); }
  };
  const doGrant = async () => {
    try {
      await adminGrantPlan({ userId: grant.userId, moduleKey: grant.moduleKey, tier: grant.tier, cycle: grant.cycle, trialDays: grant.trialDays ? Number(grant.trialDays) : undefined, note: grant.note || undefined });
      setGrant(null); load();
    } catch (e: any) { alert(e.message); }
  };

  return (
    <div>
      <h2 style={{ margin: '10px 0' }}>Người dùng</h2>
      <form className="searchbar" onSubmit={(e) => { e.preventDefault(); setPage(1); load(); }}>
        <input value={search} placeholder="Tìm email/tên…" onChange={(e) => setSearch(e.target.value)} />
        <button className="primary" disabled={loading}>{loading ? '…' : 'Tìm'}</button>
      </form>
      {err && <div className="error">{err}</div>}
      {data && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className="localtbl" style={{ width: '100%', marginTop: 12 }}>
              <thead><tr><th>Email</th><th>Tên</th><th>ĐT</th><th>Role</th><th>Trạng thái</th><th>Gói</th><th>Ngày ĐK</th><th></th></tr></thead>
              <tbody>
                {data.items.map((u: any) => (
                  <tr key={u.id}>
                    <td>{u.email}</td><td>{u.name || ''}</td><td>{u.phone || ''}</td><td>{u.role}</td><td>{u.status}</td>
                    <td>{u.subscriptions.length ? u.subscriptions.map((s: any) => `${s.moduleKey}/${s.tier} ${usd(s.priceUsdCents)} → ${fmt(s.expiresAt)}`).join('; ') : 'chưa có gói'}</td>
                    <td>{fmt(u.createdAt)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="ghost" onClick={() => setEdit({ ...u })}>Sửa</button>
                      {u.status !== 'banned' && <button className="ghost" onClick={() => act(u.id, 'ban')}>Ban</button>}
                      {u.status !== 'disabled' && <button className="ghost" onClick={() => act(u.id, 'disable')}>Xóa</button>}
                      {u.status !== 'active' && <button className="ghost" onClick={() => act(u.id, 'activate')}>Kích hoạt</button>}
                      <button className="ghost" onClick={() => setGrant({ userId: u.id, email: u.email, moduleKey: mods[0]?.key || '', tier: 'pro', cycle: 'monthly', trialDays: '', note: '' })}>Cấp gói</button>
                      <button className="ghost" onClick={async () => { try { setSubs({ userId: u.id, email: u.email, items: await adminUserSubs(u.id) }); } catch (e: any) { alert(e.message); } }}>Gói</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>←</button>
            <span>Trang {data.page} · {data.total} user</span>
            <button className="ghost" disabled={page * data.pageSize >= data.total} onClick={() => setPage((p) => p + 1)}>→</button>
          </div>
        </>
      )}
      {edit && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setEdit(null)}>
          <div style={{ background: '#fff', padding: 20, borderRadius: 12, width: 320, display: 'flex', flexDirection: 'column', gap: 10 }} onClick={(e) => e.stopPropagation()}>
            <b>Sửa {edit.email}</b>
            <input placeholder="Tên" value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <input placeholder="Điện thoại" value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
            <select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}><option value="user">user</option><option value="manager">manager</option><option value="admin">admin</option></select>
            <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}><option value="active">active</option><option value="banned">banned</option><option value="disabled">disabled</option></select>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="ghost" onClick={() => setEdit(null)}>Hủy</button>
              <button className="primary" onClick={saveEdit}>Lưu</button>
            </div>
          </div>
        </div>
      )}
      {grant && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setGrant(null)}>
          <div style={{ background: '#fff', padding: 20, borderRadius: 12, width: 320, display: 'flex', flexDirection: 'column', gap: 10 }} onClick={(e) => e.stopPropagation()}>
            <b>Cấp gói cho {grant.email}</b>
            <select value={grant.moduleKey} onChange={(e) => setGrant({ ...grant, moduleKey: e.target.value })}>{mods.map((m) => <option key={m.key} value={m.key}>{m.key}</option>)}</select>
            <input placeholder="tier (basic/pro/premium)" value={grant.tier} onChange={(e) => setGrant({ ...grant, tier: e.target.value })} />
            <select value={grant.cycle} onChange={(e) => setGrant({ ...grant, cycle: e.target.value })}><option value="monthly">monthly</option><option value="yearly">yearly</option></select>
            <input placeholder="trial (ngày, tùy chọn)" value={grant.trialDays} onChange={(e) => setGrant({ ...grant, trialDays: e.target.value })} />
            <input placeholder="ghi chú" value={grant.note} onChange={(e) => setGrant({ ...grant, note: e.target.value })} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button className="ghost" onClick={() => setGrant(null)}>Hủy</button><button className="primary" onClick={doGrant}>Cấp</button></div>
          </div>
        </div>
      )}
      {subs && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setSubs(null)}>
          <div style={{ background: '#fff', padding: 20, borderRadius: 12, width: 380, display: 'flex', flexDirection: 'column', gap: 8 }} onClick={(e) => e.stopPropagation()}>
            <b>Gói của {subs.email}</b>
            {subs.items.length === 0 && <div>Chưa có gói.</div>}
            {subs.items.map((s: any) => (
              <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span>{s.moduleKey}/{s.tier} · {s.cycle} · {s.status} · hết hạn {s.expiresAt ? new Date(s.expiresAt).toLocaleDateString('vi-VN') : ''}</span>
                {s.status === 'active' && <button className="ghost" onClick={async () => { try { await adminRevokeSub(s.id); setSubs({ ...subs, items: await adminUserSubs(subs.userId) }); load(); } catch (e: any) { alert(e.message); } }}>Thu hồi</button>}
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="ghost" onClick={() => setSubs(null)}>Đóng</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
