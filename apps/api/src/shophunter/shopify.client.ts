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
        let nextUrl: string;
        try {
          nextUrl = new URL(loc, url).toString();
        } catch {
          resolve({ status: res.statusCode || 0, body: `Invalid redirect Location: ${loc}` });
          return;
        }
        resolve(httpsGet(nextUrl, headers, ms, redirectsLeft - 1));
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

export interface StorefrontMeta { id: number | null; name: string | null; currency: string | null; country: string | null; myshopifyDomain: string | null }

// Phát hiện Shopify ĐỘC LẬP với ShopHunter (giống "view-source"): meta.json trước (JSON meta có id/currency/
// myshopify_domain — id CHÍNH LÀ shop_id Shopify); nếu meta.json fail → bắt marker Shopify trong HTML trang chủ.
// Hỗ trợ nhận diện nâng cao: bắt [a-z0-9-]+\.myshopify\.com trong script bên thứ 3 và tự động dò subdomain e-commerce (shop.*, store.*).
export async function detectShopifyStorefront(
  shopUrl: string,
  getFn?: (url: string, headers?: any) => Promise<{ status: number; body: string }>,
): Promise<{ isShopify: boolean; meta: StorefrontMeta | null; detectedDomain?: string }> {
  const domain = normalizeDomain(shopUrl);
  const get = getFn || shopifyHttp.get;
  try {
    const res = await get(`https://${domain}/meta.json`, { 'user-agent': STOREFRONT_UA });
    if (res.status === 200) {
      const j = JSON.parse(res.body);
      if (j && (j.id != null || j.myshopify_domain)) {
        return {
          isShopify: true,
          detectedDomain: domain,
          meta: {
            id: j.id != null && /^\d+$/.test(String(j.id)) ? Number(j.id) : null,
            name: typeof j.name === 'string' ? j.name : null,
            currency: typeof j.currency === 'string' && /^[A-Za-z]{3}$/.test(j.currency) ? j.currency.toUpperCase() : null,
            country: typeof j.country === 'string' ? j.country : null,
            myshopifyDomain: typeof j.myshopify_domain === 'string' ? j.myshopify_domain : null,
          },
        };
      }
    }
  } catch { /* thử marker HTML */ }

  try {
    const res = await get(`https://${domain}/`, { 'user-agent': STOREFRONT_UA });
    if (res.status === 200) {
      const html = res.body;

      // 1. Kiểm tra marker trực tiếp
      const hasDirectShopifyMarker =
        /cdn\.shopify\.com|cdn\.shopifycloud\.com|shopifycdn\.com|monorail-edge\.shopifysvc\.com|\/cdn\/shop\/|Shopify\.theme|Shopify\.shop\s*=/i.test(html);

      // 2. Tìm myshopify domain trong HTML (kể cả script nhúng tracker như Nosto, Klaviyo, v.v.)
      const myShopMatch = html.match(/([a-z0-9][a-z0-9-]*)\.myshopify\.com/i);
      const myShopDomain = myShopMatch ? `${myShopMatch[1].toLowerCase()}.myshopify.com` : null;

      // 3. Tìm shop id Shopify xuất hiện trong HTML (ví dụ: shopify-29145366588.js hoặc Shopify.shop = "...")
      const idMatch =
        html.match(/shopify-(\d{8,})/i) ||
        html.match(/Shopify\.shop\s*=\s*["']?(\d+)["']?/i);
      const extractedId = idMatch && /^\d+$/.test(idMatch[1]) ? Number(idMatch[1]) : null;

      // 4. Tìm title trang nếu có
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const extractedTitle = titleMatch ? titleMatch[1].trim() : null;

      // 5. Nếu trang chính không phải Shopify trực tiếp, nhưng là domain cha (vd simon.com):
      // Dò các link trỏ tới subdomain bán hàng nội bộ: shop.<root> hoặc store.<root>
      const cleanDom = domain.replace(/^www\./i, '');
      const subCandidateRegex = new RegExp(`https?:\\/\\/((?:shop|store)\\.${cleanDom.replace(/\./g, '\\.')})[\\/?"'\\s]`, 'i');
      const subMatch = html.match(subCandidateRegex);
      const candidateSubdomain = subMatch ? subMatch[1].toLowerCase() : `shop.${cleanDom}`;

      if (candidateSubdomain && candidateSubdomain !== domain && candidateSubdomain !== `www.${domain}`) {
        try {
          const subRes = await get(`https://${candidateSubdomain}/meta.json`, { 'user-agent': STOREFRONT_UA });
          if (subRes.status === 200) {
            const sj = JSON.parse(subRes.body);
            if (sj && (sj.id != null || sj.myshopify_domain)) {
              return {
                isShopify: true,
                detectedDomain: candidateSubdomain,
                meta: {
                  id: sj.id != null && /^\d+$/.test(String(sj.id)) ? Number(sj.id) : extractedId,
                  name: typeof sj.name === 'string' ? sj.name : extractedTitle,
                  currency: typeof sj.currency === 'string' && /^[A-Za-z]{3}$/.test(sj.currency) ? sj.currency.toUpperCase() : null,
                  country: typeof sj.country === 'string' ? sj.country : null,
                  myshopifyDomain: typeof sj.myshopify_domain === 'string' ? sj.myshopify_domain : myShopDomain,
                },
              };
            }
          }
        } catch { /* subdomain meta.json không tồn tại */ }
      }

      if (hasDirectShopifyMarker || myShopDomain || extractedId) {
        return {
          isShopify: true,
          detectedDomain: domain,
          meta: {
            id: extractedId,
            name: extractedTitle,
            currency: null,
            country: null,
            myshopifyDomain: myShopDomain,
          },
        };
      }
    }
  } catch { /* bỏ qua */ }

  // 6. Fallback thăm dò chủ động subdomain shop.<domain> nếu chưa thử
  const cleanDom = domain.replace(/^www\./i, '');
  if (!cleanDom.startsWith('shop.') && !cleanDom.startsWith('store.')) {
    const directShopSub = `shop.${cleanDom}`;
    try {
      const subRes = await get(`https://${directShopSub}/meta.json`, { 'user-agent': STOREFRONT_UA });
      if (subRes.status === 200) {
        const sj = JSON.parse(subRes.body);
        if (sj && (sj.id != null || sj.myshopify_domain)) {
          return {
            isShopify: true,
            detectedDomain: directShopSub,
            meta: {
              id: sj.id != null && /^\d+$/.test(String(sj.id)) ? Number(sj.id) : null,
              name: typeof sj.name === 'string' ? sj.name : null,
              currency: typeof sj.currency === 'string' && /^[A-Za-z]{3}$/.test(sj.currency) ? sj.currency.toUpperCase() : null,
              country: typeof sj.country === 'string' ? sj.country : null,
              myshopifyDomain: typeof sj.myshopify_domain === 'string' ? sj.myshopify_domain : null,
            },
          };
        }
      }
    } catch { /* fallback probe thất bại */ }
  }

  return { isShopify: false, meta: null };
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
