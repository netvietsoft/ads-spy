import './globals.css';
import type { Metadata, Viewport } from 'next';
import { TopNav } from './components/TopNav';

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
        <TopNav />
        {children}
      </body>
    </html>
  );
}
