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

// fetch có timeout (AbortController) — tránh TREO vô hạn khi shop throttle/hang connection.
async function fetchT(url: string, opts: any = {}, ms = 20000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function normalizeDomain(shopUrl: string): string {
  return shopUrl.replace(/^https?:\/\//i, '').split('/')[0];
}

export async function fetchShopifyCatalog(
  shopUrl: string,
  opts?: { maxPages?: number },
): Promise<{ status: 'ok' | 'blocked' | 'empty'; products: ShopifyProduct[] }> {
  const maxPages = opts?.maxPages ?? 40;
  const domain = normalizeDomain(shopUrl);
  const headers = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  };
  const products: ShopifyProduct[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = `https://${domain}/products.json?limit=250&page=${page}`;
    let res: Response;
    try {
      res = await fetchT(url, { headers });
    } catch {
      return { status: 'blocked', products: [] };
    }
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      return { status: 'blocked', products: [] };
    }
    const text = await res.text();
    const trimmed = text.trimStart();
    if (trimmed.startsWith('<')) {
      return { status: 'blocked', products: [] };
    }
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      return { status: 'blocked', products: [] };
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
