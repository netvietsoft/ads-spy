// Nghiệp vụ affnet: import net, discovery 1 lượt, fetch 1 lượt (song song theo làn IP), uỷ quyền đọc dữ liệu.
import { Injectable } from '@nestjs/common';
import { AffnetMysql } from './affnet.mysql';
import { AffnetFetch, joinUrlOf } from './affnet.fetch';
import { discoverNet } from './affnet.discovery';

@Injectable()
export class AffnetService {
  constructor(private readonly db: AffnetMysql, private readonly fetch: AffnetFetch) {}

  // Giống normalizeDomain của search.service.ts: bỏ scheme, bỏ www., cắt tại '/', lowercase.
  normalizeNet(raw: string): string {
    return String(raw || '').trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim();
  }

  platformOf(net: string): string {
    return net === 'getrewardful.com' ? 'rewardful' : 'generic';
  }

  async importNets(text: string): Promise<{ imported: number; skipped: number }> {
    const lines = String(text || '').split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    const seen = new Set<string>();
    const nets: { net: string; platform: string }[] = [];
    let skipped = 0;
    for (const line of lines) {
      const net = this.normalizeNet(line);
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(net) || seen.has(net)) { skipped++; continue; }
      seen.add(net);
      nets.push({ net, platform: this.platformOf(net) });
    }
    if (!nets.length) return { imported: 0, skipped };
    await this.db.ensureTables();
    return { imported: await this.db.upsertNets(nets), skipped };
  }

  // 1 net/lượt, net có discover_polled_at cũ nhất (NULL trước).
  async discoverStep(cfg: { paceMs: number }): Promise<{ net: string | null; found: number; added: number }> {
    await this.db.ensureTables();
    const net = await this.db.pickNetToPoll();
    if (!net) return { net: null, found: 0, added: 0 };
    const hosts = await discoverNet(net.net, cfg.paceMs);
    const added = await this.db.upsertHosts(net.net, hosts);
    await this.db.markPolled(net.net, added);
    return { net: net.net, found: hosts.length, added };
  }

  // Mỗi lượt 1 net, chia host cho các làn IP chạy song song (mỗi làn tự giãn paceMs).
  async fetchStep(cfg: { batch: number; paceMs: number; concurrency?: number }): Promise<{
    net: string | null; checked: number; active: number; inactive: number; notfound: number;
    blocked: number; laneErrors: number; lanes: number;
  }> {
    await this.db.ensureTables();
    // Proxy xoay: đọc pool sh_proxy (Settings → Proxy) MỖI LƯỢT → đổi proxy trên web là lượt sau có hiệu lực.
    // Pool rỗng (hoặc mọi proxy status='die') → setProxies([]) tạo đúng 1 làn TRỰC TIẾP, job vẫn chạy.
    await this.fetch.setProxies(await this.db.listHttpProxies());
    const lanes = Math.max(1, Math.min(cfg.concurrency ?? this.fetch.laneCount(), this.fetch.laneCount()));
    const out = { net: null as string | null, checked: 0, active: 0, inactive: 0, notfound: 0, blocked: 0, laneErrors: 0, lanes };

    for (const n of await this.db.listNets()) {
      if (n.enabled === false) continue;
      // Fingerprint trang giả: 1 lần/net, TRƯỚC khi quét (net catch-all trả 200 cho mọi host).
      let fake = { len: n.fakeLen, hash: n.fakeHash };
      if (!n.fakeCheckedAt) {
        const f = await this.fetch.probeFake(n.net);
        await this.db.setFakeBaseline(n.net, f.len, f.hash);
        fake = { len: f.len, hash: f.hash };
      }
      const hosts = await this.db.takeHostsToCheck(n.net, cfg.batch);
      if (!hosts.length) continue;
      out.net = n.net;

      let idx = 0;
      // 1 worker = 1 LÀN = 1 IP. Giãn paceMs nằm TRONG worker → giãn theo từng IP, không phải toàn cục.
      const worker = async (lane: number) => {
        while (true) {
          const i = idx++;
          if (i >= hosts.length) return;
          const h = hosts[i];
          let r: { outcome: string; parsed: any; termsText: string | null };
          try {
            r = await this.fetch.fetchCampaign(n.net, h.slug, fake, lane);
          } catch (e) {
            // Proxy chết / lỗi mạng của LÀN này → coi như CHƯA BIẾT (đừng kết luận), khai tử làn này,
            // các làn khác chạy tiếp. Đếm riêng để biết proxy hỏng chứ không phải Cloudflare chặn.
            out.laneErrors++;
            await this.db.bumpHostTries(n.net, h.slug);
            return;
          }
          out.checked++;
          if (r.outcome === 'blocked') {
            out.blocked++;                                   // CHƯA BIẾT → quét lại lượt sau
            await this.db.bumpHostTries(n.net, h.slug);
          } else if (r.outcome === 'active' && r.parsed) {
            out.active++;
            await this.db.upsertProgram({
              ...r.parsed, net: n.net, slug: h.slug,
              joinUrl: joinUrlOf(n.net, h.slug), termsText: r.termsText,
              status: 'active', fetchedAt: Date.now(),
            });
            await this.db.markHostChecked(n.net, h.slug, 'active');
          } else {
            if (r.outcome === 'inactive') out.inactive++;
            else if (r.outcome === 'notfound') out.notfound++;
            await this.db.markHostChecked(n.net, h.slug, r.outcome);
          }
          if (cfg.paceMs > 0) await new Promise((res) => setTimeout(res, cfg.paceMs));
        }
      };
      await Promise.all(Array.from({ length: lanes }, (_, l) => worker(l)));
      break; // xong 1 net là dừng lượt này
    }
    return out;
  }

  async netSummaries() {
    return this.db.netSummaries();
  }

  async deleteNet(net: string): Promise<void> {
    await this.db.deleteNet(net);
  }

  async programList(q: Parameters<AffnetMysql['programList']>[0]): Promise<{ rows: any[]; total: number }> {
    return this.db.programList(q);
  }

  async programDetail(net: string, slug: string): Promise<any | null> {
    return this.db.programDetail(net, slug);
  }
}
