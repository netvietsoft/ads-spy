import * as https from 'https';

export interface ShopifyProduct {
  id: string;
  handle: string;
  title: string;
  price: number | null;
  image: string | null;
  variantCount: number;
  publishedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

// PURE — không network. Bóc envelope products.json + phòng thủ null/thiếu field.
export function parseShopifyProducts(raw: any): ShopifyProduct[] {
  const products = raw?.products;
  if (!Array.isArray(products)) return [];
  return products.map((p: any) => {
    const variants = Array.isArray(p?.variants) ? p.variants : [];
    const images = Array.isArray(p?.images) ? p.images : [];
    const firstPrice = variants[0]?.price;
    return {
      id: String(p.id),
      handle: p.handle,
      title: p.title,
      price: firstPrice != null ? Number(firstPrice) : null,
      image: images[0]?.src ?? null,
      variantCount: variants.length,
      publishedAt: p?.published_at ?? null,
      createdAt: p?.created_at ?? null,
      updatedAt: p?.updated_at ?? null,
    };
  });
}

// GET qua module https (KHÔNG dùng global fetch/undici — bị Shopify fingerprint-chặn trả 429 local_rate_limited
// cho mọi shop; https cổ điển thì 200). Tự follow redirect (shop hay 301 www/custom domain), có timeout chống treo.
function httpsGet(url: string, headers: Record<string, string>, ms = 20000, redirectsLeft = 5): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, timeout: ms }, (res) => {
      const loc = res.headers.location;
      if (loc && [301, 302, 307, 308].includes(res.statusCode || 0) && redirectsLeft > 0) {
        res.resume();
        resolve(httpsGet(new URL(loc, url).toString(), headers, ms, redirectsLeft - 1));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// Seam để test mock (spec đổi shopifyHttp.get thay vì mock mạng thật).
export const shopifyHttp = { get: httpsGet };

function normalizeDomain(shopUrl: string): string {
  return shopUrl.replace(/^https?:\/\//i, '').split('/')[0];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const STOREFRONT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

// Tiền tệ THẬT của shop từ storefront /meta.json (ShopHunter hay gắn sai `currency`). Trả mã ISO (INR/JPY/USD…) hoặc null.
export async function fetchStorefrontCurrency(shopUrl: string): Promise<string | null> {
  const domain = normalizeDomain(shopUrl);
  try {
    const res = await shopifyHttp.get(`https://${domain}/meta.json`, { 'user-agent': STOREFRONT_UA });
    if (res.status !== 200) return null;
    const c = JSON.parse(res.body)?.currency;
    return typeof c === 'string' && /^[A-Za-z]{3}$/.test(c) ? c.toUpperCase() : null;
  } catch { return null; }
}

// Giá MIN (rẻ nhất) trong các variant của 1 sản phẩm — theo tiền tệ store — từ /products/{handle}.json.
export async function fetchProductMinPrice(shopUrl: string, handle: string): Promise<number | null> {
  if (!handle) return null;
  const domain = normalizeDomain(shopUrl);
  try {
    const res = await shopifyHttp.get(`https://${domain}/products/${encodeURIComponent(handle)}.json`, { 'user-agent': STOREFRONT_UA });
    if (res.status !== 200) return null;
    const variants = JSON.parse(res.body)?.product?.variants;
    const prices = (Array.isArray(variants) ? variants : []).map((v: any) => Number(v?.price)).filter((n: number) => Number.isFinite(n) && n > 0);
    return prices.length ? Math.min(...prices) : null;
  } catch { return null; }
}

export async function fetchShopifyCatalog(
  shopUrl: string,
  opts?: { maxPages?: number; pageDelayMs?: number; retryDelayMs?: number },
): Promise<{ status: 'ok' | 'blocked' | 'empty'; products: ShopifyProduct[] }> {
  const maxPages = opts?.maxPages ?? 40;
  const pageDelayMs = opts?.pageDelayMs ?? 400; // nghỉ giữa các trang — 40 request dồn dập dễ dính rate-limit/security
  const retryDelayMs = opts?.retryDelayMs ?? 1500; // 429 → nghỉ rồi thử lại đúng 1 lần
  const domain = normalizeDomain(shopUrl);
  const headers = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  };
  const products: ShopifyProduct[] = [];
  // Lỗi giữa chừng: đã có trang nào thì trả partial 'ok' (KHÔNG vứt trang đã lấy — rotation sau INSERT IGNORE bù tiếp);
  // chưa có gì (trang 1) → 'blocked' như cũ.
  const bail = () => (products.length ? { status: 'ok' as const, products } : { status: 'blocked' as const, products: [] });

  for (let page = 1; page <= maxPages; page++) {
    if (page > 1 && pageDelayMs) await sleep(pageDelayMs);
    const url = `https://${domain}/products.json?limit=250&page=${page}`;
    let res: { status: number; body: string };
    try {
      res = await shopifyHttp.get(url, headers);
      if (res.status === 429) {
        await sleep(retryDelayMs);
        res = await shopifyHttp.get(url, headers);
      }
    } catch {
      return bail();
    }
    if (res.status === 429) return bail(); // vẫn bị bóp sau retry
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      return bail();
    }
    const text = res.body;
    const trimmed = text.trimStart();
    if (trimmed.startsWith('<')) {
      return bail();
    }
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      return bail();
    }
    const pageProducts = parseShopifyProducts(json);
    if (page === 1 && pageProducts.length === 0) {
      return { status: 'empty', products: [] };
    }
    products.push(...pageProducts);
    if (pageProducts.length < 250) break;
  }

  return { status: 'ok', products };
}
