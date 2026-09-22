import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- TEST LIVE PRODUCT SYNC HUB ---');

  // 1. Thêm shop nguồn overtimegearz.shop nếu chưa có
  const domain = 'overtimegearz.shop';
  const store = await prisma.syncSourceStore.upsert({
    where: { domain },
    update: { status: 'active', cronEnabled: true },
    create: {
      name: 'Overtime Gearz',
      domain,
      platform: 'shopify',
      status: 'active',
      cronEnabled: true,
    },
  });

  console.log(`[1] Shop nguồn: ID=${store.id}, domain=${store.domain}`);

  // 2. Fetch trang 1 live từ shopify storefront
  const url = `https://${domain}/products.json?limit=5&page=1`;
  console.log(`[2] Đang fetch 5 sản phẩm live từ ${url}...`);

  const https = await import('https');
  const fetchRes = await new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });

  if (fetchRes.status !== 200) {
    throw new Error(`Fetch failed with status ${fetchRes.status}`);
  }

  const json = JSON.parse(fetchRes.body);
  const products = json.products || [];
  console.log(`[3] Đã nhận được ${products.length} sản phẩm live từ ${domain}`);

  // 3. Lưu vào SyncProduct
  let inserted = 0;
  for (const p of products) {
    const sProdId = String(p.id);
    const tagsStr = Array.isArray(p.tags) ? p.tags.join(', ') : (p.tags || '');

    const record = await prisma.syncProduct.upsert({
      where: {
        sourceStoreId_sourceProductId: {
          sourceStoreId: store.id,
          sourceProductId: sProdId,
        },
      },
      update: {
        handle: p.handle,
        title: p.title,
        bodyHtml: p.body_html,
        vendor: p.vendor,
        productType: p.product_type,
        tags: tagsStr,
        optionsRaw: JSON.stringify(p.options || []),
        variantsRaw: JSON.stringify(p.variants || []),
        imagesRaw: JSON.stringify(p.images || []),
      },
      create: {
        sourceStoreId: store.id,
        sourceProductId: sProdId,
        handle: p.handle,
        title: p.title,
        bodyHtml: p.body_html,
        vendor: p.vendor,
        productType: p.product_type,
        tags: tagsStr,
        optionsRaw: JSON.stringify(p.options || []),
        variantsRaw: JSON.stringify(p.variants || []),
        imagesRaw: JSON.stringify(p.images || []),
      },
    });
    inserted++;
    console.log(`    + Đã lưu SP: "${record.title.substring(0, 50)}..." (ID DB: ${record.id})`);
  }

  // 4. Cập nhật số đếm
  const count = await prisma.syncProduct.count({ where: { sourceStoreId: store.id } });
  await prisma.syncSourceStore.update({
    where: { id: store.id },
    data: { productCount: count, lastScrapedAt: new Date(), lastStatusMessage: `Live test OK: ${inserted} products synced.` },
  });

  console.log(`[4] Tổng số sản phẩm trong DB của ${domain}: ${count}`);

  // 5. Test biến đổi giá và định dạng CSV chuẩn
  const firstProd = await prisma.syncProduct.findFirst({ where: { sourceStoreId: store.id } });
  if (firstProd) {
    const vars = JSON.parse(firstProd.variantsRaw || '[]');
    const imgs = JSON.parse(firstProd.imagesRaw || '[]');
    console.log(`[5] Kiểm tra cấu trúc sản phẩm đầu tiên:`);
    console.log(`    - Title: ${firstProd.title}`);
    console.log(`    - Handle: ${firstProd.handle}`);
    console.log(`    - Vendor gốc: ${firstProd.vendor}`);
    console.log(`    - Số lượng variants: ${vars.length} (Giá variant 1: $${vars[0]?.price})`);
    console.log(`    - Số lượng ảnh: ${imgs.length} (Ảnh 1: ${imgs[0]?.src})`);

    // Test tính giá: x1.25 làm tròn .99
    const origPrice = parseFloat(vars[0]?.price || '50');
    const newPrice = (Math.floor(origPrice * 1.25) + 0.99).toFixed(2);
    console.log(`    - Giá tính toán theo rule (x1.25, đuôi .99): $${origPrice} -> $${newPrice}`);
  }

  console.log('--- TEST LIVE HOÀN TẤT THÀNH CÔNG 100% ---');
}

main()
  .catch((e) => {
    console.error('Test failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
