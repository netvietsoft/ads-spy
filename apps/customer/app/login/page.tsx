'use client';
import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { login } from '../api';

export default function LoginPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await login(email, password);
      window.location.href = '/';
    } catch (e: any) {
      setErr(e?.message || t('auth.err'));
      setBusy(false);
    }
  };
  return (
    <form className="authbox" onSubmit={submit}>
      <h2 style={{ margin: 0 }}>{t('auth.login')}</h2>
      <input className="inp" type="email" placeholder={t('auth.email')} value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input className="inp" type="password" placeholder={t('auth.password')} value={password} onChange={(e) => setPassword(e.target.value)} required />
      {err && <div className="err">{err}</div>}
      <button className="btn" disabled={busy}>{t('auth.login')}</button>
      <a href="/forgot" style={{ fontSize: 13, textAlign: 'center' }}>{t('auth.forgot')}</a>
      <a href="/register" style={{ fontSize: 13, textAlign: 'center' }}>{t('auth.noAccount')}</a>
    </form>
  );
}
