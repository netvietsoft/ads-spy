// Trang landing /home — 7 công cụ (không Import/Cài đặt). Menu trên cùng do layout TopNav lo (ẩn theo quyền).
const TOOLS: [string, string, string][] = [
  ['/googleads', 'Google Ads', 'Quảng cáo Google Ads Transparency'],
  ['/facebookads', 'Facebook Ads', 'Ads Library Facebook'],
  ['/tiktokads', 'TikTok Ads', 'Top Ads TikTok'],
  ['/shophuntershopify', 'Shopify', 'Khám phá shop & sản phẩm Shopify'],
  ['/localdb/shops', 'Local DB', 'Dữ liệu shop/sản phẩm đã lưu'],
  ['/trackshopify', 'Track', 'Kiểm tra domain có phải Shopify'],
  ['/reportlocaldb', 'Báo cáo', 'Báo cáo tổng hợp doanh thu'],
];

export default function HomePage() {
  return (
    <div className="container">
      <h2 style={{ margin: '8px 0 4px' }}>Chọn công cụ</h2>
      <p style={{ color: 'var(--muted)', margin: '0 0 18px', fontSize: 14 }}>Bấm vào một mục để bắt đầu.</p>
      <div className="homegrid">
        {TOOLS.map(([href, title, desc]) => (
          <a key={href} href={href} className="homecard">
            <div className="homecard-t">{title}</div>
            <div className="homecard-d">{desc}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
