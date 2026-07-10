import { Injectable } from '@nestjs/common';
import { ShClient } from './sh.client';
import { ShMysql } from './sh.mysql';
import { ShAuth } from './sh.auth';
import { parseSearch } from './sh.parser';
import { shQueryHash } from './sh.hash';

const TTL_MS = (Number(process.env.SH_CACHE_TTL_HOURS) || 6) * 3600 * 1000;

@Injectable()
export class ShService {
  constructor(
    private readonly client: ShClient,
    private readonly mysql: ShMysql,
    private readonly auth: ShAuth,
  ) {}

  async explore(
    searchType: 'shops' | 'products',
    opts: { sort: string; q: string; categoryIds: string[]; from: number; filters?: Record<string, { gte: number | null; lte: number | null }> },
  ) {
    const table = searchType === 'shops' ? 'sh_shop' : 'sh_product';
    const pk = searchType === 'shops' ? 'shop_id' : 'product_id';
    const hash = shQueryHash(searchType, opts);

    const cached = await this.mysql.getSearchCache(hash, TTL_MS);
    if (cached) {
      const items = await this.mysql.getItemsByIds(table, cached.itemIds);
      return { items, nextFromValue: cached.nextFromValue, totalHits: cached.totalHits, cached: true };
    }

    const raw = await this.client.search(searchType, opts);
    const parsed = parseSearch<any>(raw);
    const itemIds: string[] = [];
    for (const it of parsed.items) {
      const id = String(it[pk]);
      if (!id || id === 'undefined') continue;
      itemIds.push(id);
      await this.mysql.upsertItem(table, id, it);
    }
    await this.mysql.setSearchCache(hash, {
      searchType, sortBy: opts.sort, searchString: opts.q || '', filters: { categoryIds: opts.categoryIds || [] },
      fromCount: opts.from || 0, itemIds, nextFromValue: parsed.nextFromValue, totalHits: parsed.totalHits,
    });
    return { items: parsed.items, nextFromValue: parsed.nextFromValue, totalHits: parsed.totalHits, cached: false };
  }

  setToken(token: string) {
    return this.auth.setRefreshToken(token);
  }
  tokenStatus() {
    return this.auth.status();
  }
}
