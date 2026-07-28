import './globals.css';
import { I18nProvider } from './i18n/I18nProvider';
import { Header } from './components/Header';

export const metadata = { title: 'Ads Spy' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <I18nProvider>
          <Header />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
