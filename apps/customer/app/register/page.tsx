'use client';
import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { register } from '../api';

export default function RegisterPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await register(email, password, name || undefined);
      window.location.href = '/';
    } catch (e: any) {
      setErr(e?.message || t('auth.err'));
      setBusy(false);
    }
  };
  return (
    <form className="authbox" onSubmit={submit}>
      <h2 style={{ margin: 0 }}>{t('auth.register')}</h2>
      <input className="inp" placeholder={t('auth.name')} value={name} onChange={(e) => setName(e.target.value)} />
      <input className="inp" type="email" placeholder={t('auth.email')} value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input className="inp" type="password" placeholder={t('auth.password')} value={password} onChange={(e) => setPassword(e.target.value)} required />
      {err && <div className="err">{err}</div>}
      <button className="btn" disabled={busy}>{t('auth.register')}</button>
      <a href="/login" style={{ fontSize: 13, textAlign: 'center' }}>{t('auth.haveAccount')}</a>
    </form>
  );
}
