import os
import sys
import asyncio
import aiohttp
import csv
import json
import time
import zipfile
import io

# Ensure project root is in sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.mass_scanner_core import verify_domain, OUT_DIR, CSV_FILE, SQL_FILE

sys.stdout.reconfigure(encoding='utf-8')

# 1. Load domain pool
def load_all_target_domains():
    print("==========================================================================")
    print("ĐANG THU THẬP VÀ PHÂN TẦNG KHO DOMAIN ĐỂ QUÉT QUY MÔ LỚN (MASS SCAN)...")
    print("==========================================================================")
    
    seen = set()
    queue = []
    
    # Priority 1: 12,089 Top Revenue Shopify Stores
    sp_file = r"E:\Shopify\Shopify_-_2026-10-07_verified_shopify.csv"
    if os.path.exists(sp_file):
        with open(sp_file, 'r', encoding='utf-8', errors='ignore') as f:
            reader = csv.reader(f)
            header = next(reader)
            rev_idx = [i for i, h in enumerate(header) if 'Sales Revenue' in h][0] if any('Sales Revenue' in h for h in header) else -1
            spend_idx = [i for i, h in enumerate(header) if 'Technology Spend' in h][0] if any('Technology Spend' in h for h in header) else -1
            comp_idx = [i for i, h in enumerate(header) if 'Company' in h][0] if any('Company' in h for h in header) else -1
            
            p1_count = 0
            for row in reader:
                if not row: continue
                d = row[0].strip().lower()
                if not d or '.' not in d or d in seen: continue
                rev = row[rev_idx].strip() if rev_idx != -1 and len(row) > rev_idx else ''
                spend = row[spend_idx].strip() if spend_idx != -1 and len(row) > spend_idx else ''
                comp = row[comp_idx].strip() if comp_idx != -1 and len(row) > comp_idx else ''
                
                if rev and rev != '$0':
                    seen.add(d)
                    queue.append({'domain': d, 'company': comp, 'revenue': rev, 'spend': spend, 'priority': 1, 'net': None})
                    p1_count += 1
        print(f"-> Tầng 1 (Shop có Doanh thu thực tế): {p1_count:,d} shop")

    # Priority 2: BuiltWith 21 Networks (UpPromote 85k, GoAffPro 61k, BixGrow, Collabs...)
    bw_dir = r"E:\Shopify\Build with"
    zips_to_load = [
        ('UpPromote', 'All_Live_UpPromote_Sites_-_2026-09-17.zip'),
        ('UpPromote', 'All_Live_Secomapp_Sites_-_2026-09-20.zip'),
        ('GoAffPro', 'All_Live_GoAffPro_Sites_-_2026-09-17.zip'),
        ('BixGrow', 'All_Live_BixGrow_Sites_-_2026-10-05.zip'),
        ('Shopify Collabs', 'All_Live_Shopify_Collabs_Sites_-_2026-09-17.zip'),
        ('Social Snowball', 'All_Live_Social_Snowball_Sites_-_2026-09-17.zip'),
        ('Refersion', 'All_Live_Refersion_Sites_-_2026-09-17.zip'),
        ('Affiliatly', 'All_Live_Affiliatly_Sites_-_2026-09-20.zip'),
        ('Rewardful', 'All_Live_Rewardful_Sites_-_2026-09-17.zip'),
        ('FirstPromoter', 'All_Live_FirstPromoter_Sites_-_2026-09-18.zip'),
        ('Post Affiliate Pro', 'All_Live_Post_Affiliate_Pro_Sites_-_2026-09-17.zip'),
        ('Tolt', 'All_Live_Tolt_Sites_-_2026-09-17.zip'),
        ('PromoteKit', 'All_Live_PromoteKit_Sites_-_2026-09-19.zip'),
        ('Superfiliate', 'All_Live_Superfiliate_Sites_-_2026-09-17.zip'),
        ('Impact', 'All_Live_Impact_Sites_-_2026-09-17.zip'),
        ('AWIN', 'All_Live_AWIN_Sites_-_2026-10-03.zip'),
        ('Rakuten', 'All_Live_Rakuten_Affiliate_Sites_-_2026-09-17.zip'),
        ('PartnerStack', 'All_Live_PartnerStack_Sites_-_2026-09-29.zip')
    ]
    
    p2_count = 0
    for net_name, zname in zips_to_load:
        zp = os.path.join(bw_dir, zname)
        if os.path.exists(zp):
            try:
                with zipfile.ZipFile(zp, 'r') as zf:
                    for fname in zf.namelist():
                        if fname.endswith('.csv'):
                            with zf.open(fname) as cf:
                                for line in io.TextIOWrapper(cf, encoding='utf-8', errors='ignore'):
                                    d = line.split(',', 1)[0].strip().lower()
                                    if d and '.' in d and not d.startswith('root domain') and d not in seen:
                                        seen.add(d)
                                        queue.append({'domain': d, 'company': d.split('.')[0].capitalize(), 'revenue': '', 'spend': '', 'priority': 2, 'net': net_name})
                                        p2_count += 1
            except:
                pass
    print(f"-> Tầng 2 (Các Net BuiltWith UpPromote, GoAffPro...): {p2_count:,d} domain")
    
    # Priority 3: Remaining Shopify verified
    p3_count = 0
    if os.path.exists(sp_file):
        with open(sp_file, 'r', encoding='utf-8', errors='ignore') as f:
            reader = csv.reader(f)
            next(reader)
            for row in reader:
                if not row: continue
                d = row[0].strip().lower()
                if d and '.' in d and d not in seen:
                    seen.add(d)
                    queue.append({'domain': d, 'company': d.split('.')[0].capitalize(), 'revenue': '', 'spend': '', 'priority': 3, 'net': None})
                    p3_count += 1
    print(f"-> Tầng 3 (Các shop Shopify còn lại): {p3_count:,d} shop")
    print(f"TỔNG CỘNG HÀNG ĐỢI QUÉT: {len(queue):,d} DOMAINS\n")
    return queue

async def run_mass_scan(limit=None):
    queue = load_all_target_domains()
    if limit:
        queue = queue[:limit]

    print("==========================================================================")
    print(f"KHỞI CHẠY BOT QUÉT TỰ ĐỘNG: {len(queue):,d} DOMAINS")
    print("Đa luồng: 100 workers | Batch: 300 shop/lần | Tự động Checkpoint")
    print(f"File CSV: {CSV_FILE}")
    print(f"File SQL: {SQL_FILE}")
    print("==========================================================================")

    # Initialize SQL file if needed
    if not os.path.exists(SQL_FILE):
        with open(SQL_FILE, 'w', encoding='utf-8') as f:
            f.write("-- MASS VERIFIED LIVE AFFILIATE PROJECTS\n\n")

    sem = asyncio.Semaphore(150) # 150 concurrent workers
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
    conn = aiohttp.TCPConnector(ssl=False, limit=300, resolver=aiohttp.ThreadedResolver())
    
    CHECKPOINT_FILE = os.path.join(OUT_DIR, "checkpoint.json")
    start_index = 0
    total_live_found = 0

    if os.path.exists(CHECKPOINT_FILE):
        try:
            with open(CHECKPOINT_FILE, 'r', encoding='utf-8') as f_cp:
                cp = json.load(f_cp)
                start_index = cp.get('last_index', 0)
                total_live_found = cp.get('total_live_found', 0)
                print(f"[CHECKPOINT] Phục hồi phiên trước từ vị trí: {start_index:,d} (Đã có {total_live_found:,d} dự án sống)")
        except:
            pass

    if os.path.exists(CSV_FILE):
        try:
            with open(CSV_FILE, 'r', encoding='utf-8', errors='ignore') as f:
                r = csv.reader(f)
                header = next(r, None)
                if header:
                    csv_count = sum(1 for _ in r)
                    if csv_count > total_live_found:
                        total_live_found = csv_count
        except:
            pass

    start_time = time.time()
    batch_size = 300

    async with aiohttp.ClientSession(headers=headers, connector=conn) as session:
        for b_start in range(start_index, len(queue), batch_size):
            batch = queue[b_start:b_start + batch_size]
            tasks = [verify_domain(session, item, sem) for item in batch]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            now_ms = int(time.time() * 1000)
            valid_results = [r for r in results if isinstance(r, dict) and r.get('is_live_project')]
            
            if valid_results:
                total_live_found += len(valid_results)
                
                # Append to CSV
                file_exists = os.path.exists(CSV_FILE)
                with open(CSV_FILE, 'a', newline='', encoding='utf-8') as f_csv:
                    writer = csv.writer(f_csv)
                    if not file_exists:
                        writer.writerow(['domain', 'slug', 'company', 'net', 'revenue', 'spend', 'join_url', 'form_title', 'verified_at'])
                    for r in valid_results:
                        writer.writerow([
                            r['domain'], r['slug'], r['company'], r['net'],
                            r['revenue'], r['spend'], r['join_url'], r['form_title'], now_ms
                        ])

                # Append to SQL (aff_program & aff_host)
                sql_hosts = []
                sql_progs = []
                for r in valid_results:
                    c_net = r['net'].lower().replace(' ', '')
                    if not c_net.endswith('.com') and not c_net.endswith('.io'):
                        c_net += '.com'
                    c_slug = r['slug'].replace("'", "''")
                    c_dom = r['domain'].replace("'", "''")
                    c_comp = r['company'].replace("'", "''")
                    c_url = r['join_url'].replace("'", "''")

                    sql_hosts.append(f"('{c_net}', '{c_slug}', {now_ms}, {now_ms}, 'mass-verified', {now_ms}, 'active', 1)")
                    sql_progs.append(f"('{c_net}', '{c_slug}', '{c_url}', '{c_comp}', '{c_dom}', 'active', {now_ms})")

                with open(SQL_FILE, 'a', encoding='utf-8') as f_sql:
                    f_sql.write("INSERT INTO aff_host (net, slug, first_seen, last_seen, sources, checked_at, check_status, check_tries) VALUES\n")
                    f_sql.write(',\n'.join(sql_hosts))
                    f_sql.write("\nON DUPLICATE KEY UPDATE check_status='active', checked_at=VALUES(checked_at);\n\n")

                    f_sql.write("INSERT INTO aff_program (net, slug, join_url, program_name, brand_domain, status, scanned_at) VALUES\n")
                    f_sql.write(',\n'.join(sql_progs))
                    f_sql.write("\nON DUPLICATE KEY UPDATE join_url=VALUES(join_url), status='active', scanned_at=VALUES(scanned_at);\n\n")

            done = min(b_start + batch_size, len(queue))
            elapsed = time.time() - start_time
            speed = done / elapsed if elapsed > 0 else 0
            print(f"[MASS SCAN] Đã quét: {done:,d}/{len(queue):,d} ({done/len(queue)*100:.1f}%) | "
                  f"DỰ ÁN SỐNG 100%: {total_live_found:,d} | "
                  f"Tốc độ: {speed:.1f} shop/s", flush=True)

            # Save checkpoint
            try:
                with open(CHECKPOINT_FILE, 'w', encoding='utf-8') as f_cp:
                    json.dump({'last_index': done, 'total_live_found': total_live_found, 'updated_at': int(time.time()*1000)}, f_cp)
            except:
                pass

    print("\n==========================================================================")
    print("HOÀN THÀNH QUÉT QUY MÔ LỚN!")
    print(f"- Tổng số dự án sống xác minh thành công: {total_live_found:,d}")
    print(f"- File CSV: {CSV_FILE}")
    print(f"- File SQL: {SQL_FILE}")
    print("==========================================================================")

if __name__ == '__main__':
    limit_arg = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else None
    asyncio.run(run_mass_scan(limit=limit_arg))
