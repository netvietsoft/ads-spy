'use client';
import { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const nextUrl = () => {
    if (typeof window === 'undefined') return '/home';
    const n = new URLSearchParams(window.location.search).get('next');
    // Chỉ nhận đường dẫn nội bộ; chặn '//host' (protocol-relative → open redirect).
    return n && n.startsWith('/') && !n.startsWith('//') ? n : '/home';
  };

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true); setErr('');
    try {
      const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        // Khách (role user) → trang khách; staff → next/'/home'.
        if (data?.user?.role === 'user') { window.location.href = '/landing'; return; }
        window.location.href = nextUrl();
        return;
      }
      setErr(data?.message || 'Email hoặc mật khẩu không đúng');
    } catch { setErr('Lỗi kết nối'); }
    setLoading(false);
  };

  const forgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true); setErr(''); setMsg('');
    try {
      await fetch('/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      setMsg('Nếu email tồn tại, liên kết đặt lại mật khẩu đã được gửi.');
    } catch { setErr('Lỗi kết nối'); }
    setLoading(false);
  };

  const inputStyle = { padding: '11px 12px', borderRadius: 9, border: '1px solid #d1d5db', fontSize: 15, outline: 'none' } as const;
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f6f8', fontFamily: 'system-ui, sans-serif' }}>
      <form onSubmit={mode === 'login' ? login : forgot} style={{ width: 340, background: '#fff', padding: 28, borderRadius: 14, boxShadow: '0 8px 30px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 22, fontWeight: 700, textAlign: 'center' }}>Ads <span style={{ color: '#16a34a' }}>Spy</span></div>
        <div style={{ fontSize: 13, color: '#6b7280', textAlign: 'center', marginTop: -6 }}>{mode === 'login' ? 'Đăng nhập' : 'Đặt lại mật khẩu'}</div>
        <input type="email" value={email} autoFocus placeholder="Email" onChange={(e) => { setEmail(e.target.value); setErr(''); }} style={inputStyle} />
        {mode === 'login' && (
          <input type="password" value={pw} placeholder="Mật khẩu" onChange={(e) => { setPw(e.target.value); setErr(''); }} style={inputStyle} />
        )}
        <button type="submit" disabled={loading} style={{ padding: '11px 12px', borderRadius: 9, border: 'none', background: loading ? '#9ca3af' : '#16a34a', color: '#fff', fontSize: 15, fontWeight: 600, cursor: loading ? 'default' : 'pointer' }}>
          {loading ? 'Đang xử lý…' : mode === 'login' ? 'Đăng nhập' : 'Gửi liên kết đặt lại'}
        </button>
        {mode === 'login' && (
          <a href={`/api/auth/google?next=${encodeURIComponent(nextUrl())}`} style={{ padding: '10px 12px', borderRadius: 9, border: '1px solid #d1d5db', textAlign: 'center', textDecoration: 'none', color: '#111827', fontSize: 14, fontWeight: 600 }}>
            Đăng nhập bằng Google
          </a>
        )}
        {err && <div style={{ color: '#e0384f', fontSize: 13, textAlign: 'center' }}>{err}</div>}
        {msg && <div style={{ color: '#16a34a', fontSize: 13, textAlign: 'center' }}>{msg}</div>}
        <button type="button" onClick={() => { setMode(mode === 'login' ? 'forgot' : 'login'); setErr(''); setMsg(''); }} style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 13, cursor: 'pointer' }}>
          {mode === 'login' ? 'Quên mật khẩu?' : '← Quay lại đăng nhập'}
        </button>
        {mode === 'login' && (
          <a href="/register" style={{ color: '#2563eb', fontSize: 13, textAlign: 'center', textDecoration: 'none' }}>Chưa có tài khoản? Đăng ký</a>
        )}
      </form>
    </div>
  );
}
