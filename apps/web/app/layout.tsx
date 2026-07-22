import './globals.css';
import type { Metadata } from 'next';
import { TopNav } from './components/TopNav';

export const metadata: Metadata = {
  title: 'Google Ads Spy',
  description: 'Nhập domain, xem mọi quảng cáo Google Ads Transparency, nhà quảng cáo và asset.',
};

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
