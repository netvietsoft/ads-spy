'use client';
import { useState } from 'react';

export default function LoginPage() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw || loading) return;
    setLoading(true); setErr(false);
    try {
      const r = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (r.ok) {
        const next = new URLSearchParams(window.location.search).get('next');
        window.location.href = next && next.startsWith('/') ? next : '/';
        return;
      }
      setErr(true);
    } catch { setErr(true); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f6f8', fontFamily: 'system-ui, sans-serif' }}>
      <form onSubmit={submit} style={{ width: 320, background: '#fff', padding: 28, borderRadius: 14, boxShadow: '0 8px 30px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 22, fontWeight: 700, textAlign: 'center' }}>Ads <span style={{ color: '#16a34a' }}>Spy</span></div>
        <div style={{ fontSize: 13, color: '#6b7280', textAlign: 'center', marginTop: -6 }}>Nhập mật khẩu để truy cập</div>
        <input
          type="password" value={pw} autoFocus placeholder="Mật khẩu"
          onChange={(e) => { setPw(e.target.value); setErr(false); }}
          style={{ padding: '11px 12px', borderRadius: 9, border: `1px solid ${err ? '#e0384f' : '#d1d5db'}`, fontSize: 15, outline: 'none' }}
        />
        <button type="submit" disabled={loading || !pw}
          style={{ padding: '11px 12px', borderRadius: 9, border: 'none', background: loading || !pw ? '#9ca3af' : '#16a34a', color: '#fff', fontSize: 15, fontWeight: 600, cursor: loading || !pw ? 'default' : 'pointer' }}>
          {loading ? 'Đang vào…' : 'Đăng nhập'}
        </button>
        {err && <div style={{ color: '#e0384f', fontSize: 13, textAlign: 'center' }}>Sai mật khẩu</div>}
      </form>
    </div>
  );
}
