import './globals.css';
import type { Metadata, Viewport } from 'next';
import { TopNav } from './components/TopNav';
import { I18nProvider } from './i18n/I18nProvider';

export const metadata: Metadata = {
  title: 'Google Ads Spy',
  description: 'Nhập domain, xem mọi quảng cáo Google Ads Transparency, nhà quảng cáo và asset.',
};

// Responsive mobile: đảm bảo viewport = device-width để media query menu mobile kích hoạt.
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <I18nProvider>
          <TopNav />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
