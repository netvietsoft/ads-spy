'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import vi from './vi.json';
import en from './en.json';

const DICT: Record<string, Record<string, string>> = { vi: vi as any, en: en as any };
type Ctx = { lang: string; t: (k: string) => string; setLang: (l: string) => void };
const I18nCtx = createContext<Ctx>({ lang: 'vi', t: (k) => k, setLang: () => {} });

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState('vi');
  useEffect(() => {
    const c = document.cookie.match(/(?:^|; )lang=([^;]+)/)?.[1];
    const saved = c || localStorage.getItem('lang') || 'vi';
    if (DICT[saved]) setLangState(saved);
  }, []);
  const setLang = (l: string) => {
    setLangState(l);
    try {
      localStorage.setItem('lang', l);
      document.cookie = `lang=${l};path=/;max-age=31536000`;
    } catch {}
  };
  const t = (k: string) => DICT[lang]?.[k] ?? DICT.vi?.[k] ?? k;
  return <I18nCtx.Provider value={{ lang, t, setLang }}>{children}</I18nCtx.Provider>;
}
export const useI18n = () => useContext(I18nCtx);
