import { notFound } from 'next/navigation';
import Home from '../page';

export const dynamic = 'force-dynamic';

// Catch-all: mọi path tab (/googleads, /localdb/shops, /trackshopify...) render cùng SPA Home ở app/page.tsx.
// Nếu request là file tĩnh bị thiếu (vd: .css, .js cũ không còn trên disk), trả 404 ngay lập tức
// thay vì render HTML 200 khiến browser từ chối nạp CSS vì sai MIME type (text/html).
export default async function CatchAllPage(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const last = params?.slug?.[params.slug.length - 1] || '';
  if (/\.(css|js|json|png|jpg|jpeg|svg|ico|webp|woff|woff2|map)$/i.test(last)) {
    notFound();
  }
  return <Home />;
}
