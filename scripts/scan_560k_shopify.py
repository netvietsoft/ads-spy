import os
import sys
import csv
import json
import time
import socket
import asyncio
import aiohttp
import re
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

DATA_FILE = r"E:\Shopify\Shopify_-_2026-10-07_verified_shopify.csv"
OUTPUT_DIR = r"E:\Shopify\output_560k_verified"
os.makedirs(OUTPUT_DIR, exist_ok=True)

CSV_OUT_PATH = os.path.join(OUTPUT_DIR, "shopify_affiliates_discovered.csv")
SQL_OUT_PATH = os.path.join(OUTPUT_DIR, "shopify_affiliates_import.sql")
STATE_PATH = os.path.join(OUTPUT_DIR, "scanner_state.json")

# 1. Signatures for 25+ Affiliate Networks
NET_SIGNATURES = [
    ('UpPromote', re.compile(r'uppromote|secomapp|af\.uppromote\.com|cdn\.uppromote\.com', re.I)),
    ('GoAffPro', re.compile(r'goaffpro|api\.goaffpro\.com|static\.goaffpro\.com|\/a\/goaffpro', re.I)),
    ('Shopify Collabs', re.compile(r'collabs\.shopify|join\.collabs\.shopify', re.I)),
    ('Social Snowball', re.compile(r'socialsnowball|social-snowball', re.I)),
    ('BixGrow', re.compile(r'bixgrow|bixgrow\.com', re.I)),
    ('Refersion', re.compile(r'refersion|\.refersion\.com', re.I)),
    ('Affiliatly', re.compile(r'affiliatly|\.affiliatly\.com', re.I)),
    ('Superfiliate', re.compile(r'superfiliate', re.I)),
    ('ShopJar', re.compile(r'shopjar|referral-and-affiliates', re.I)),
    ('Bubblehouse', re.compile(r'bubblehouse\.com', re.I)),
    ('Rewardful', re.compile(r'rewardful|r\.wdfl\.co', re.I)),
    ('FirstPromoter', re.compile(r'firstpromoter|\$fprom|fprom\.io', re.I)),
    ('Impact', re.compile(r'impact\.com|impactradius|utt\.impactcdn', re.I)),
    ('AWIN', re.compile(r'awin\.com|awin1\.com', re.I)),
    ('Rakuten', re.compile(r'rakuten|linkshare', re.I)),
    ('Post Affiliate Pro', re.compile(r'postaffiliatepro', re.I)),
    ('LeadDyno', re.compile(r'leaddyno', re.I)),
    ('Tolt', re.compile(r'tolt\.io', re.I)),
    ('PromoteKit', re.compile(r'promotekit', re.I)),
    ('PartnerStack', re.compile(r'partnerstack|growsumo', re.I)),
    ('Shopify Forms', re.compile(r'ShopifyForms|forms-root-', re.I)),
    ('Google Forms', re.compile(r'docs\.google\.com\/forms', re.I)),
]

AFF_KEYWORDS = ['affiliate', 'ambassador', 'creator', 'collab', 'partner', 'referral', 'promoter']
IGNORE_DOMAINS = ['facebook.com', 'instagram.com', 'twitter.com', 'tiktok.com', 'pinterest.com', 'youtube.com', 'linkedin.com', 'google.com/search', 'shopify.com/legal']

# Fast domain pre-lookup from 21 Build with files if available
KNOWN_NETS = {}
buildwith_verified = r"E:\Shopify\Build with\output_verified\all_nets_verified.csv"
if os.path.exists(buildwith_verified):
    try:
        with open(buildwith_verified, 'r', encoding='utf-8', errors='ignore') as f:
            r = csv.DictReader(f)
            for row in r:
                KNOWN_NETS[row['domain']] = row['net']
        print(f"Đã nạp {len(KNOWN_NETS):,d} shop đã xác minh từ đợt quét trước.")
    except:
        pass

async def probe_single_shop(session, shop, semaphore):
    domain = shop['domain']
    slug = domain.split('.')[0]
    out = {
        'domain': domain,
        'slug': slug,
        'company': shop['company'] or slug.capitalize(),
        'revenue': shop['revenue'],
        'spend': shop['spend'],
        'is_alive': False,
        'has_aff': False,
        'join_url': None,
        'net': KNOWN_NETS.get(domain, None),
        'status_code': 0,
        'method': None
    }

    loop = asyncio.get_running_loop()
    try:
        # Fast DNS check (1ms)
        await loop.run_in_executor(None, socket.gethostbyname, domain)
    except Exception:
        return out

    try:
        async with semaphore:
            # 1. Fetch homepage
            url = f"https://{domain}"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=4), ssl=False, allow_redirects=True) as resp:
                out['status_code'] = resp.status
                if resp.status < 400:
                    out['is_alive'] = True
                    html = await resp.text(errors='ignore')

                    # Detect Net from HTML signatures if not already known
                    if not out['net']:
                        for net_name, pattern in NET_SIGNATURES:
                            if pattern.search(html):
                                out['net'] = net_name
                                break

                    # Look for affiliate link in HTML
                    links = re.findall(r'href=["\']([^"\']+)["\']', html, re.I)
                    for l in links:
                        l_low = l.lower()
                        if any(kw in l_low for kw in AFF_KEYWORDS):
                            if not any(ign in l_low for ign in IGNORE_DOMAINS) and not l_low.startswith('#') and not l_low.startswith('javascript:'):
                                full = l if l.startswith('http') else f"https://{domain}{'' if l.startswith('/') else '/'}{l}"
                                out['join_url'] = full
                                out['has_aff'] = True
                                out['method'] = 'homepage_link'
                                break

            # 2. If alive but no link found, probe standard affiliate paths
            if out['is_alive'] and not out['join_url']:
                for path in ['/pages/affiliate', '/pages/affiliates', '/pages/affiliate-program', '/pages/collabs']:
                    try:
                        p_url = f"https://{domain}{path}"
                        async with session.get(p_url, timeout=aiohttp.ClientTimeout(total=3), ssl=False, allow_redirects=True) as p_resp:
                            if p_resp.status < 400 and '/password' not in str(p_resp.url):
                                out['join_url'] = str(p_resp.url)
                                out['has_aff'] = True
                                out['method'] = 'probe_path'
                                p_html = await p_resp.text(errors='ignore')
                                if not out['net']:
                                    for net_name, pattern in NET_SIGNATURES:
                                        if pattern.search(p_html):
                                            out['net'] = net_name
                                            break
                                break
                    except:
                        pass

            # 3. If net is known but no link found, fallback to canonical net portal
            if out['is_alive'] and out['net'] and not out['join_url']:
                if 'uppromote' in out['net'].lower():
                    out['join_url'] = f"https://af.uppromote.com/{slug}/register"
                    out['has_aff'] = True
                    out['method'] = 'portal_default'
                elif 'goaffpro' in out['net'].lower():
                    out['join_url'] = f"https://{slug}.goaffpro.com/create-account"
                    out['has_aff'] = True
                    out['method'] = 'portal_default'
                elif 'bixgrow' in out['net'].lower():
                    out['join_url'] = f"https://{slug}.bixgrow.com/register"
                    out['has_aff'] = True
                    out['method'] = 'portal_default'

    except Exception:
        pass

    return out

def load_shops_to_scan():
    print(f"Đang nạp và phân tầng danh sách shop từ {DATA_FILE}...")
    tier1_revenue = []
    tier2_known_net = []
    tier3_rest = []

    with open(DATA_FILE, 'r', encoding='utf-8', errors='ignore') as f:
        reader = csv.reader(f)
        header = next(reader)
        rev_idx = [i for i, h in enumerate(header) if 'Sales Revenue' in h][0] if any('Sales Revenue' in h for h in header) else -1
        spend_idx = [i for i, h in enumerate(header) if 'Technology Spend' in h][0] if any('Technology Spend' in h for h in header) else -1
        comp_idx = [i for i, h in enumerate(header) if 'Company' in h][0] if any('Company' in h for h in header) else -1

        for row in reader:
            if not row or len(row) < 1:
                continue
            d = row[0].strip().lower()
            if not d or '.' not in d or len(d) < 4:
                continue
            comp = row[comp_idx].strip() if comp_idx != -1 and len(row) > comp_idx else ''
            rev = row[rev_idx].strip() if rev_idx != -1 and len(row) > rev_idx else ''
            spend = row[spend_idx].strip() if spend_idx != -1 and len(row) > spend_idx else ''

            item = {'domain': d, 'company': comp, 'revenue': rev, 'spend': spend}
            if rev and rev != '$0':
                tier1_revenue.append(item)
            elif d in KNOWN_NETS:
                tier2_known_net.append(item)
            else:
                tier3_rest.append(item)

    print(f"Tổng hợp phân tầng ưu tiên:")
    print(f"- Tầng 1 (Shop có Doanh thu thực tế): {len(tier1_revenue):,d} shop")
    print(f"- Tầng 2 (Shop đã có sẵn nhãn Net): {len(tier2_known_net):,d} shop")
    print(f"- Tầng 3 (Các shop còn lại): {len(tier3_rest):,d} shop")
    return tier1_revenue + tier2_known_net + tier3_rest

async def run_scanner(limit=None):
    all_shops = load_shops_to_scan()
    if limit:
        all_shops = all_shops[:limit]

    print(f"\n==========================================================================")
    print(f"KHỞI CHẠY QUÉT KHO SHOPIFY ({len(all_shops):,d} SHOPS)")
    print(f"Đa luồng: 60 workers | Checkpoint: Mỗi 200 shop")
    print(f"File CSV: {CSV_OUT_PATH}")
    print(f"File SQL: {SQL_OUT_PATH}")
    print(f"==========================================================================")

    # Initialize SQL file if not exists
    if not os.path.exists(SQL_OUT_PATH):
        with open(SQL_OUT_PATH, 'w', encoding='utf-8') as f:
            f.write("-- 560K SHOPIFY AFFILIATES IMPORT\n\n")

    semaphore = asyncio.Semaphore(60) # 60 concurrent tasks
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }

    start_time = time.time()
    total_alive = 0
    total_aff = 0
    batch_size = 200

    conn = aiohttp.TCPConnector(limit=120, ssl=False, resolver=aiohttp.ThreadedResolver())
    async with aiohttp.ClientSession(headers=headers, connector=conn) as session:
        for b_start in range(0, len(all_shops), batch_size):
            batch = all_shops[b_start:b_start + batch_size]
            tasks = [probe_single_shop(session, shop, semaphore) for shop in batch]
            results = await asyncio.gather(*tasks)

            now_ms = int(time.time() * 1000)
            csv_rows = []
            sql_programs = []
            sql_hosts = []

            for r in results:
                if r['is_alive']:
                    total_alive += 1
                if r['has_aff'] and r['join_url']:
                    total_aff += 1
                    net_name = r['net'] or 'In-house/Direct'
                    clean_join = r['join_url'].replace("'", "''")
                    clean_comp = r['company'].replace("'", "''")
                    clean_slug = r['slug'].replace("'", "''")
                    clean_dom = r['domain'].replace("'", "''")

                    csv_rows.append([
                        r['domain'], r['slug'], net_name, r['join_url'], r['company'],
                        r['revenue'], r['spend'], r['method'], 'active', r['status_code']
                    ])

                    # SQL for aff_host and aff_program
                    clean_net_db = net_name.lower().replace(' ', '')
                    if not clean_net_db.endswith('.com') and not clean_net_db.endswith('.io'):
                        clean_net_db += '.com'

                    sql_programs.append(
                        f"('{clean_net_db}', '{clean_slug}', '{clean_join}', '{clean_comp}', '{clean_dom}', 'active', {now_ms})"
                    )
                    sql_hosts.append(
                        f"('{clean_net_db}', '{clean_slug}', {now_ms}, {now_ms}, 'shopify-560k', {now_ms}, 'active', 1)"
                    )

            # Append to CSV
            if csv_rows:
                file_exists = os.path.exists(CSV_OUT_PATH)
                with open(CSV_OUT_PATH, 'a', newline='', encoding='utf-8') as f:
                    writer = csv.writer(f)
                    if not file_exists:
                        writer.writerow(['domain', 'slug', 'net', 'join_url', 'company', 'revenue', 'spend', 'method', 'status', 'http_code'])
                    writer.writerows(csv_rows)

            # Append to SQL
            if sql_programs:
                with open(SQL_OUT_PATH, 'a', encoding='utf-8') as f:
                    f.write("INSERT INTO aff_host (net, slug, first_seen, last_seen, sources, checked_at, check_status, check_tries) VALUES\n")
                    f.write(',\n'.join(sql_hosts))
                    f.write("\nON DUPLICATE KEY UPDATE check_status='active', checked_at=VALUES(checked_at);\n\n")

                    f.write("INSERT INTO aff_program (net, slug, join_url, program_name, brand_domain, status, scanned_at) VALUES\n")
                    f.write(',\n'.join(sql_programs))
                    f.write("\nON DUPLICATE KEY UPDATE join_url=VALUES(join_url), status='active', scanned_at=VALUES(scanned_at);\n\n")

            done = min(b_start + batch_size, len(all_shops))
            elapsed = time.time() - start_time
            speed = done / elapsed if elapsed > 0 else 0
            print(f"[560K SHOPIFY] Tiến độ: {done:,d}/{len(all_shops):,d} ({done/len(all_shops)*100:.1f}%) | "
                  f"Web sống: {total_alive:,d} | Tìm ra Affiliate: {total_aff:,d} ({(total_aff/total_alive*100) if total_alive else 0:.1f}%) | "
                  f"Tốc độ: {speed:.1f} shop/s", flush=True)

    print(f"\n=> HOÀN THÀNH QUÉT ĐỢT NÀY!")
    print(f"- Tổng web sống: {total_alive:,d}")
    print(f"- Tổng chương trình Affiliate phát hiện: {total_aff:,d}")
    print(f"- File CSV: {CSV_OUT_PATH}")
    print(f"- File SQL: {SQL_OUT_PATH}")

if __name__ == '__main__':
    # Parse CLI argument for limit (e.g. python scan_560k_shopify.py 2000)
    limit_arg = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 2000
    asyncio.run(run_scanner(limit=limit_arg))
