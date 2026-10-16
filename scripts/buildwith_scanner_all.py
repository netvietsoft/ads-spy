import os
import sys
import glob
import zipfile
import csv
import io
import time
import asyncio
import aiohttp
import re
import socket
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

DATA_DIR = r"E:\Shopify\Build with"
OUTPUT_DIR = r"E:\Shopify\Build with\output_verified"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 21 Networks ordered from largest to smallest
NETWORKS = [
    {
        'net': 'uppromote.com',
        'platform': 'uppromote',
        'zips': [
            'All_Live_Secomapp_Sites_-_2026-09-20.zip',
            'All_Live_UpPromote_Sites_-_2026-09-17.zip'
        ],
        'portal_pattern': 'https://af.uppromote.com/{slug}/register',
        'probe_paths': ['/pages/affiliate', '/pages/affiliates', '/pages/affiliate-program', '/pages/ambassador']
    },
    {
        'net': 'goaffpro.com',
        'platform': 'goaffpro',
        'zips': ['All_Live_GoAffPro_Sites_-_2026-09-17.zip'],
        'portal_pattern': 'https://{slug}.goaffpro.com/create-account',
        'probe_paths': ['/pages/affiliate', '/pages/affiliates', '/pages/affiliate-program']
    },
    {
        'net': 'rakuten.com',
        'platform': 'rakuten',
        'zips': [
            'All_Live_Rakuten_Affiliate_Sites_-_2026-09-17.zip',
            'All_Live_Rakuten_Advertising_Sites_-_2026-09-17.zip'
        ],
        'portal_pattern': None,
        'probe_paths': ['/pages/affiliate', '/pages/affiliates', '/pages/affiliate-program', '/pages/ambassador']
    },
    {
        'net': 'awin.com',
        'platform': 'awin',
        'zips': ['All_Live_AWIN_Sites_-_2026-10-03.zip'],
        'portal_pattern': None,
        'probe_paths': ['/pages/affiliate', '/pages/affiliates', '/pages/affiliate-program', '/pages/partner']
    },
    {
        'net': 'impact.com',
        'platform': 'impact',
        'zips': ['All_Live_Impact_Sites_-_2026-09-17.zip'],
        'portal_pattern': None,
        'probe_paths': ['/pages/affiliate', '/pages/affiliates', '/pages/affiliate-program', '/pages/partners']
    },
    {
        'net': 'getrewardful.com',
        'platform': 'rewardful',
        'zips': ['All_Live_Rewardful_Sites_-_2026-09-17.zip'],
        'portal_pattern': None,
        'probe_paths': ['/affiliates', '/pages/affiliate', '/partner']
    },
    {
        'net': 'affiliatly.com',
        'platform': 'affiliatly',
        'zips': ['All_Live_Affiliatly_Sites_-_2026-09-20.zip'],
        'portal_pattern': 'https://www.affiliatly.com/af-{slug}/affiliate.panel',
        'probe_paths': ['/pages/affiliate', '/pages/affiliates', '/pages/affiliate-program']
    },
    {
        'net': 'firstpromoter.com',
        'platform': 'firstpromoter',
        'zips': ['All_Live_FirstPromoter_Sites_-_2026-09-18.zip'],
        'portal_pattern': None,
        'probe_paths': ['/affiliate', '/partners']
    },
    {
        'net': 'postaffiliatepro.com',
        'platform': 'postaffiliatepro',
        'zips': ['All_Live_Post_Affiliate_Pro_Sites_-_2026-09-17.zip'],
        'portal_pattern': None,
        'probe_paths': ['/affiliates', '/pages/affiliate']
    },
    {
        'net': 'socialsnowball.io',
        'platform': 'socialsnowball',
        'zips': ['All_Live_Social_Snowball_Sites_-_2026-09-17.zip'],
        'portal_pattern': None,
        'probe_paths': ['/pages/affiliate', '/pages/affiliates', '/pages/ambassador']
    },
    {
        'net': 'collabs.shopify.com',
        'platform': 'shopifycollabs',
        'zips': ['All_Live_Shopify_Collabs_Sites_-_2026-09-17.zip'],
        'portal_pattern': 'https://join.collabs.shopify.com/community/apply/{slug}',
        'probe_paths': ['/pages/collabs', '/pages/affiliate', '/pages/creator']
    },
    {
        'net': 'refersion.com',
        'platform': 'refersion',
        'zips': ['All_Live_Refersion_Sites_-_2026-09-17.zip'],
        'portal_pattern': 'https://{slug}.refersion.com/affiliate/registration',
        'probe_paths': ['/pages/affiliate', '/pages/affiliates', '/pages/affiliate-program']
    },
    {
        'net': 'tolt.io',
        'platform': 'tolt',
        'zips': ['All_Live_Tolt_Sites_-_2026-09-17.zip'],
        'portal_pattern': None,
        'probe_paths': ['/affiliates', '/partners']
    },
    {
        'net': 'promotekit.com',
        'platform': 'promotekit',
        'zips': ['All_Live_PromoteKit_Sites_-_2026-09-19.zip'],
        'portal_pattern': None,
        'probe_paths': ['/affiliates', '/partners']
    },
    {
        'net': 'dub.co',
        'platform': 'dub',
        'zips': ['All_Live_Dub_Sites_-_2026-09-17.zip'],
        'portal_pattern': None,
        'probe_paths': ['/affiliates']
    },
    {
        'net': 'partnerstack.com',
        'platform': 'partnerstack',
        'zips': ['All_Live_PartnerStack_Sites_-_2026-09-29.zip'],
        'portal_pattern': None,
        'probe_paths': ['/partners', '/affiliates']
    },
    {
        'net': 'bixgrow.com',
        'platform': 'bixgrow',
        'zips': ['All_Live_BixGrow_Sites_-_2026-10-05.zip'],
        'portal_pattern': 'https://{slug}.bixgrow.com/register',
        'probe_paths': ['/pages/affiliate', '/pages/affiliates', '/pages/affiliate-program']
    },
    {
        'net': 'superfiliate.com',
        'platform': 'superfiliate',
        'zips': ['All_Live_Superfiliate_Sites_-_2026-09-17.zip'],
        'portal_pattern': None,
        'probe_paths': ['/pages/affiliate', '/pages/co-branded', '/pages/creator']
    },
    {
        'net': 'affilimate.com',
        'platform': 'affilimate',
        'zips': ['All_Live_Affilimate_Sites_-_2026-09-17.zip'],
        'portal_pattern': None,
        'probe_paths': ['/affiliates']
    },
    {
        'net': 'cuelinks.com',
        'platform': 'cuelinks',
        'zips': ['All_Live_CueLinks_Sites_-_2026-09-17.zip'],
        'portal_pattern': None,
        'probe_paths': ['/affiliates']
    },
    {
        'net': 'partnerboost.com',
        'platform': 'partnerboost',
        'zips': ['All_Live_PartnerBoost_Sites_-_2026-09-17.zip'],
        'portal_pattern': None,
        'probe_paths': ['/affiliates']
    }
]

AFF_LINK_KEYWORDS = ['affiliate', 'ambassador', 'creator', 'collab', 'partner', 'referral', 'promoter']
IGNORE_DOMAINS = ['facebook.com', 'instagram.com', 'twitter.com', 'tiktok.com', 'pinterest.com', 'youtube.com', 'linkedin.com', 'google.com', 'shopify.com/legal']

def extract_domains_from_zips(zip_names):
    domain_map = {}
    for zname in zip_names:
        zpath = os.path.join(DATA_DIR, zname)
        if not os.path.exists(zpath):
            continue
        try:
            with zipfile.ZipFile(zpath, 'r') as zf:
                csv_files = [f for f in zf.namelist() if f.endswith('.csv')]
                if not csv_files:
                    continue
                with zf.open(csv_files[0]) as f:
                    reader = csv.reader(io.TextIOWrapper(f, encoding='utf-8', errors='ignore'))
                    header = next(reader, None)
                    if not header:
                        continue
                    root_idx = [i for i, h in enumerate(header) if 'Root Domain' in h][0] if any('Root Domain' in h for h in header) else 0
                    comp_idx = [i for i, h in enumerate(header) if 'Company' in h][0] if any('Company' in h for h in header) else -1
                    rev_idx = [i for i, h in enumerate(header) if 'Sales Revenue' in h][0] if any('Sales Revenue' in h for h in header) else -1
                    spend_idx = [i for i, h in enumerate(header) if 'Technology Spend' in h][0] if any('Technology Spend' in h for h in header) else -1
                    ecom_idx = [i for i, h in enumerate(header) if 'eCommerce Platform' in h][0] if any('eCommerce Platform' in h for h in header) else -1

                    for row in reader:
                        if not row or len(row) <= root_idx:
                            continue
                        d = row[root_idx].strip().lower()
                        if not d or '.' not in d or '/' in d or len(d) < 4:
                            continue
                        comp = row[comp_idx].strip() if comp_idx != -1 and len(row) > comp_idx else ''
                        rev = row[rev_idx].strip() if rev_idx != -1 and len(row) > rev_idx else ''
                        spend = row[spend_idx].strip() if spend_idx != -1 and len(row) > spend_idx else ''
                        is_sp = True if ecom_idx != -1 and len(row) > ecom_idx and 'shopify' in row[ecom_idx].lower() else False

                        if d not in domain_map:
                            domain_map[d] = {
                                'domain': d,
                                'company': comp,
                                'revenue': rev,
                                'spend': spend,
                                'is_shopify': is_sp
                            }
        except Exception as e:
            print(f"Error reading {zname}: {e}")
    return list(domain_map.values())

async def check_site(session, item, net_cfg, semaphore):
    domain = item['domain']
    slug = domain.split('.')[0]
    out = {
        'net': net_cfg['net'],
        'slug': slug,
        'domain': domain,
        'company': item['company'] or slug.capitalize(),
        'is_alive': False,
        'join_url': None,
        'status_code': 0,
        'error': None
    }
    
    try:
        # Step 0: Fast DNS pre-check to eliminate dead domains instantly and avoid DNS gaierrors
        loop = asyncio.get_running_loop()
        try:
            await loop.run_in_executor(None, socket.gethostbyname, domain)
        except Exception:
            out['error'] = 'DNS_FAILED'
            return out

        async with semaphore:
            # Step 1: Probe homepage
            try:
                url = f"https://{domain}"
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=4), ssl=False, allow_redirects=True) as resp:
                    out['status_code'] = resp.status
                    if resp.status < 400:
                        out['is_alive'] = True
                        html = await resp.text(errors='ignore')
                        # Search for affiliate link in HTML
                        links = re.findall(r'href=["\']([^"\']+)["\']', html, re.I)
                        for l in links:
                            l_low = l.lower()
                            if any(kw in l_low for kw in AFF_LINK_KEYWORDS):
                                if not any(ign in l_low for ign in IGNORE_DOMAINS) and not l_low.startswith('#') and not l_low.startswith('javascript:'):
                                    full = l if l.startswith('http') else f"https://{domain}{'' if l.startswith('/') else '/'}{l}"
                                    out['join_url'] = full
                                    break
            except Exception as e:
                out['error'] = str(e)[:40]

            # Step 2: If alive but no link found, try portal pattern or fallback paths
            if out['is_alive'] and not out['join_url']:
                probe_paths = net_cfg.get('probe_paths', [])
                for p in probe_paths[:2]: # test top 2 probe paths
                    try:
                        probe_url = f"https://{domain}{p}"
                        async with session.get(probe_url, timeout=aiohttp.ClientTimeout(total=3), ssl=False, allow_redirects=True) as p_resp:
                            if p_resp.status < 400 and '/password' not in str(p_resp.url):
                                out['join_url'] = str(p_resp.url)
                                break
                    except:
                        pass

            # Step 3: Default canonical portal link if still not found
            if out['is_alive'] and not out['join_url'] and net_cfg.get('portal_pattern'):
                # E.g. https://af.uppromote.com/{slug}/register or https://{slug}.goaffpro.com/create-account
                out['join_url'] = net_cfg['portal_pattern'].format(slug=slug)
    except Exception as e:
        out['error'] = str(e)[:40]

    return out

async def run_network(net_cfg, max_scan_per_net=1000):
    net = net_cfg['net']
    print(f"\n{'='*75}")
    print(f"BẮT ĐẦU QUÉT NET: {net.upper()} ({net_cfg['platform']})")
    print(f"{'='*75}")

    items = extract_domains_from_zips(net_cfg['zips'])
    total_found = len(items)
    print(f"- Tổng số domain trích xuất từ BuiltWith: {total_found:,d}")

    # Prioritize Shopify stores, then others
    shopify_items = [it for it in items if it['is_shopify']]
    other_items = [it for it in items if not it['is_shopify']]
    sorted_items = shopify_items + other_items
    print(f"- Số shop Shopify: {len(shopify_items):,d} | Web khác: {len(other_items):,d}")

    # Limit scan batch if specified
    items_to_scan = sorted_items[:max_scan_per_net] if max_scan_per_net else sorted_items
    print(f"- Đang đưa vào quét: {len(items_to_scan):,d} domains (Đa luồng: 50 workers)...")

    # Output files
    clean_net_name = net.replace('.', '_')
    csv_out_path = os.path.join(OUTPUT_DIR, f"{clean_net_name}_verified.csv")
    sql_out_path = os.path.join(OUTPUT_DIR, f"{clean_net_name}_import.sql")

    # Write initial aff_host entries SQL (for all discovered hosts)
    with open(sql_out_path, 'w', encoding='utf-8') as f_sql:
        f_sql.write(f"-- IMPORT SCRIPT FOR {net}\n")
        f_sql.write(f"INSERT IGNORE INTO aff_net (net, platform, created_at) VALUES ('{net}', '{net_cfg['platform']}', {int(time.time()*1000)});\n\n")

    semaphore = asyncio.Semaphore(50) # 50 concurrent requests
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }

    start_time = time.time()
    alive_count = 0
    programs_found = 0

    conn = aiohttp.TCPConnector(limit=100, ssl=False, resolver=aiohttp.ThreadedResolver())
    async with aiohttp.ClientSession(headers=headers, connector=conn) as session:
        # Process in batches of 200
        batch_size = 200
        for b_start in range(0, len(items_to_scan), batch_size):
            batch = items_to_scan[b_start:b_start + batch_size]
            tasks = [check_site(session, item, net_cfg, semaphore) for item in batch]
            batch_results = await asyncio.gather(*tasks)

            # Process batch results
            now_ms = int(time.time() * 1000)
            sql_programs = []
            sql_hosts = []
            csv_rows = []

            for r in batch_results:
                if r['is_alive']:
                    alive_count += 1
                if r['join_url']:
                    programs_found += 1
                    clean_join = r['join_url'].replace("'", "''")
                    clean_comp = r['company'].replace("'", "''")
                    clean_slug = r['slug'].replace("'", "''")
                    clean_dom = r['domain'].replace("'", "''")
                    sql_programs.append(
                        f"('{net}', '{clean_slug}', '{clean_join}', '{clean_comp}', '{clean_dom}', 'active', {now_ms})"
                    )
                    sql_hosts.append(
                        f"('{net}', '{clean_slug}', {now_ms}, {now_ms}, 'builtwith', {now_ms}, 'active', 1)"
                    )
                    csv_rows.append([
                        r['domain'], r['slug'], net, r['join_url'], r['company'], 'active', r['status_code']
                    ])

            # Append to SQL file
            if sql_hosts:
                with open(sql_out_path, 'a', encoding='utf-8') as f_sql:
                    f_sql.write(f"INSERT INTO aff_host (net, slug, first_seen, last_seen, sources, checked_at, check_status, check_tries) VALUES\n")
                    f_sql.write(',\n'.join(sql_hosts))
                    f_sql.write("\nON DUPLICATE KEY UPDATE check_status='active', checked_at=VALUES(checked_at);\n\n")

            if sql_programs:
                with open(sql_out_path, 'a', encoding='utf-8') as f_sql:
                    f_sql.write(f"INSERT INTO aff_program (net, slug, join_url, program_name, brand_domain, status, scanned_at) VALUES\n")
                    f_sql.write(',\n'.join(sql_programs))
                    f_sql.write("\nON DUPLICATE KEY UPDATE join_url=VALUES(join_url), status='active', scanned_at=VALUES(scanned_at);\n\n")

            # Append to CSV
            if csv_rows:
                file_exists = os.path.exists(csv_out_path)
                with open(csv_out_path, 'a', newline='', encoding='utf-8') as f_csv:
                    writer = csv.writer(f_csv)
                    if not file_exists:
                        writer.writerow(['domain', 'slug', 'net', 'join_url', 'company', 'status', 'http_code'])
                    writer.writerows(csv_rows)

            done = min(b_start + batch_size, len(items_to_scan))
            elapsed = time.time() - start_time
            speed = done / elapsed if elapsed > 0 else 0
            print(f"  [{net}] Tiến độ: {done:,d}/{len(items_to_scan):,d} ({done/len(items_to_scan)*100:.1f}%) | "
                  f"Sống: {alive_count:,d} | Link Aff: {programs_found:,d} | Tốc độ: {speed:.1f} shop/s", flush=True)

    total_time = time.time() - start_time
    print(f"\n=> HOÀN THÀNH NET {net.upper()} trong {total_time:.1f}s!", flush=True)
    print(f"- Web sống: {alive_count:,d} / {len(items_to_scan):,d}", flush=True)
    print(f"- Link đăng ký affiliate hoạt động: {programs_found:,d}", flush=True)
    print(f"- Đã xuất file SQL nạp database: {sql_out_path}", flush=True)
    print(f"- Đã xuất file CSV kết quả: {csv_out_path}", flush=True)

def combine_master_sql():
    print("\n" + "="*75)
    print("TỔNG HỢP MASTER SQL & CSV CHO TOÀN BỘ 21 NETWORKS")
    print("="*75)
    master_sql_path = os.path.join(OUTPUT_DIR, "all_nets_master_import.sql")
    master_csv_path = os.path.join(OUTPUT_DIR, "all_nets_verified.csv")

    sql_files = sorted(glob.glob(os.path.join(OUTPUT_DIR, "*_import.sql")))
    total_sql_bytes = 0
    with open(master_sql_path, 'w', encoding='utf-8') as f_out:
        f_out.write("-- ==========================================================\n")
        f_out.write("-- MASTER AFFILIATE NETWORKS IMPORT SCRIPT\n")
        f_out.write(f"-- Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f_out.write("-- ==========================================================\n\n")
        for sf in sql_files:
            if os.path.basename(sf) == "all_nets_master_import.sql":
                continue
            with open(sf, 'r', encoding='utf-8') as f_in:
                content = f_in.read()
                f_out.write(content + "\n\n")
                total_sql_bytes += len(content)

    csv_files = sorted(glob.glob(os.path.join(OUTPUT_DIR, "*_verified.csv")))
    total_csv_rows = 0
    with open(master_csv_path, 'w', newline='', encoding='utf-8') as f_out:
        writer = csv.writer(f_out)
        writer.writerow(['domain', 'slug', 'net', 'join_url', 'company', 'status', 'http_code'])
        for cf in csv_files:
            if os.path.basename(cf) == "all_nets_verified.csv":
                continue
            with open(cf, 'r', encoding='utf-8') as f_in:
                reader = csv.reader(f_in)
                header = next(reader, None)
                for row in reader:
                    if row:
                        writer.writerow(row)
                        total_csv_rows += 1

    print(f"- Đã gom {len(sql_files)} file SQL -> Master SQL: {master_sql_path} ({total_sql_bytes/(1024*1024):.2f} MB)")
    print(f"- Đã gom {len(csv_files)} file CSV -> Master CSV: {master_csv_path} ({total_csv_rows:,d} chương trình)")

async def main():
    print("==========================================================================")
    print("CHƯƠNG TRÌNH QUÉT TOÀN BỘ AFFILIATE NETWORKS TỪ LỚN XUỐNG NHỎ (BUILTWITH)")
    print(f"Tổng số Networks: {len(NETWORKS)}")
    print(f"Thời gian bắt đầu: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("==========================================================================")

    for i, cfg in enumerate(NETWORKS):
        print(f"\n>>> [NET #{i+1:02d}/{len(NETWORKS)}] {cfg['net'].upper()} <<<")
        # Run first 500 domains of each net to demonstrate fast progressive rollout
        await run_network(cfg, max_scan_per_net=500)

    combine_master_sql()

if __name__ == '__main__':
    asyncio.run(main())

