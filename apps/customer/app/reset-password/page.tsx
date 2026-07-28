'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useI18n } from '../i18n/I18nProvider';
import { resetPassword } from '../api';

function ResetForm() {
  const { t } = useI18n();
  const token = useSearchParams().get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (password !== confirm) {
      setErr(t('auth.mismatch'));
      return;
    }
    setBusy(true);
    try {
      await resetPassword(token, password);
      setDone(true);
      setTimeout(() => (window.location.href = '/login'), 1200);
    } catch (e: any) {
      setErr(e?.message || t('auth.err'));
      setBusy(false);
    }
  };
  return (
    <form className="authbox" onSubmit={submit}>
      <h2 style={{ margin: 0 }}>{t('auth.newPassword')}</h2>
      {done ? (
        <div className="ok">{t('auth.resetDone')}</div>
      ) : (
        <>
          <input className="inp" type="password" placeholder={t('auth.newPassword')} value={password} onChange={(e) => setPassword(e.target.value)} required />
          <input className="inp" type="password" placeholder={t('auth.confirmPassword')} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          {err && <div className="err">{err}</div>}
          <button className="btn" disabled={busy || !token}>{t('auth.newPassword')}</button>
        </>
      )}
    </form>
  );
}

export default function ResetPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
