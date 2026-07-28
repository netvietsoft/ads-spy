'use client';
import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { forgot } from '../api';

export default function ForgotPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try { await forgot(email); } catch {}
    setSent(true);
    setBusy(false);
  };
  return (
    <form className="authbox" onSubmit={submit}>
      <h2 style={{ margin: 0 }}>{t('auth.forgot')}</h2>
      {sent ? (
        <div className="ok">{t('auth.resetSent')}</div>
      ) : (
        <>
          <input className="inp" type="email" placeholder={t('auth.email')} value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button className="btn" disabled={busy}>{t('auth.sendReset')}</button>
        </>
      )}
      <a href="/login" style={{ fontSize: 13, textAlign: 'center' }}>{t('auth.haveAccount')}</a>
    </form>
  );
}
