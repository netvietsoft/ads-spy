'use client';
import { useState } from 'react';

export default function ResetPasswordPage() {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    const token = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('token') || '' : '';
    if (!token) { setErr('Thiếu token đặt lại'); return; }
    if (pw.length < 8) { setErr('Mật khẩu tối thiểu 8 ký tự'); return; }
    if (pw !== pw2) { setErr('Mật khẩu nhập lại không khớp'); return; }
    setLoading(true);
    try {
      const r = await fetch('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password: pw }) });
      if (r.ok) { setDone(true); setTimeout(() => (window.location.href = '/login'), 1500); }
      else { const d = await r.json().catch(() => ({})); setErr(d?.message || 'Token không hợp lệ hoặc đã hết hạn'); }
    } catch { setErr('Lỗi kết nối'); }
    setLoading(false);
  };

  const inputStyle = { padding: '11px 12px', borderRadius: 9, border: '1px solid #d1d5db', fontSize: 15, outline: 'none' } as const;
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f6f8', fontFamily: 'system-ui, sans-serif' }}>
      <form onSubmit={submit} style={{ width: 340, background: '#fff', padding: 28, borderRadius: 14, boxShadow: '0 8px 30px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 20, fontWeight: 700, textAlign: 'center' }}>Đặt lại mật khẩu</div>
        {done ? (
          <div style={{ color: '#16a34a', fontSize: 14, textAlign: 'center' }}>Đã đổi mật khẩu. Đang chuyển tới đăng nhập…</div>
        ) : (
          <>
            <input type="password" value={pw} autoFocus placeholder="Mật khẩu mới" onChange={(e) => { setPw(e.target.value); setErr(''); }} style={inputStyle} />
            <input type="password" value={pw2} placeholder="Nhập lại mật khẩu" onChange={(e) => { setPw2(e.target.value); setErr(''); }} style={inputStyle} />
            <button type="submit" disabled={loading} style={{ padding: '11px 12px', borderRadius: 9, border: 'none', background: loading ? '#9ca3af' : '#16a34a', color: '#fff', fontSize: 15, fontWeight: 600, cursor: loading ? 'default' : 'pointer' }}>
              {loading ? 'Đang lưu…' : 'Đổi mật khẩu'}
            </button>
            {err && <div style={{ color: '#e0384f', fontSize: 13, textAlign: 'center' }}>{err}</div>}
          </>
        )}
      </form>
    </div>
  );
}
