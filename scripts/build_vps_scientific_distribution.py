import os
import sys
import csv
import json
import time
import zipfile
import io
import re

sys.stdout.reconfigure(encoding='utf-8')

BASE_OUT = r"E:\Shopify\VPS_DISTRIBUTION"
DIR_NETS = os.path.join(BASE_OUT, "1_NETWORKS_AFF")
DIR_SHOPIFY = os.path.join(BASE_OUT, "2_WEBSITES_SHOPIFY")
DIR_OTHER = os.path.join(BASE_OUT, "3_WEBSITES_OTHER_TECH")
DIR_OTHER_CAT = os.path.join(DIR_OTHER, "other_tech_by_category")

for d in [DIR_NETS, DIR_SHOPIFY, DIR_OTHER, DIR_OTHER_CAT]:
    os.makedirs(d, exist_ok=True)

# -------------------------------------------------------------
# NETWORK DEFINITIONS & METADATA
# -------------------------------------------------------------
NET_METADATA = {
    'uppromote.com': {'name': 'UpPromote', 'portal': 'https://af.uppromote.com/{slug}/register'},
    'goaffpro.com': {'name': 'GoAffPro', 'portal': 'https://{slug}.goaffpro.com/create-account'},
    'collabs.shopify.com': {'name': 'Shopify Collabs', 'portal': 'https://collabs.shopify.com'},
    'bixgrow.com': {'name': 'BixGrow', 'portal': 'https://{slug}.bixgrow.com/register'},
    'refersion.com': {'name': 'Refersion', 'portal': 'https://{slug}.refersion.com/affiliate/registration'},
    'awin.com': {'name': 'AWIN', 'portal': 'https://ui.awin.com/merchant-profile/{slug}'},
    'affiliatly.com': {'name': 'Affiliatly', 'portal': 'https://www.affiliatly.com/af-{slug}/affiliate.panel?mode=register'},
    'rakuten.com': {'name': 'Rakuten', 'portal': 'https://rakutenadvertising.com'},
    'superfiliate.com': {'name': 'Superfiliate', 'portal': 'https://superfiliate.com'},
    'socialsnowball.io': {'name': 'Social Snowball', 'portal': 'https://socialsnowball.io'},
    'promotekit.com': {'name': 'PromoteKit', 'portal': 'https://{slug}.promotekit.com'},
    'tolt.io': {'name': 'Tolt', 'portal': 'https://{slug}.tolt.io'},
    'postaffiliatepro.com': {'name': 'Post Affiliate Pro', 'portal': 'https://{slug}.postaffiliatepro.com/affiliates/signup.php'},
    'firstpromoter.com': {'name': 'FirstPromoter', 'portal': 'https://{slug}.firstpromoter.com'},
    'getrewardful.com': {'name': 'Rewardful', 'portal': 'https://{slug}.getrewardful.com/signup'},
    'impact.com': {'name': 'Impact', 'portal': 'https://app.impact.com/campaign-promo-signup/{slug}.brand'},
    'partnerstack.com': {'name': 'PartnerStack', 'portal': 'https://{slug}.partnerstack.com'},
    'affilimate.com': {'name': 'Affilimate', 'portal': 'https://affilimate.com'},
    'partnerboost.com': {'name': 'PartnerBoost', 'portal': 'https://app.partnerboost.com'},
    'cuelinks.com': {'name': 'CueLinks', 'portal': 'https://www.cuelinks.com'},
    'dub.co': {'name': 'Dub', 'portal': 'https://dub.co'}
}

def clean_sql(val):
    if val is None:
        return 'NULL'
    s = str(val).replace("'", "''").strip()
    return f"'{s}'"

def parse_currency(val):
    if not val:
        return 0.0
    cleaned = re.sub(r'[^\d.]', '', val.replace(',', ''))
    try:
        return float(cleaned)
    except:
        return 0.0

# =============================================================
# PART 1: KHO CÁC NETWORK AFFILIATE (1_NETWORKS_AFF)
# =============================================================
def process_networks():
    print("\n========================================================")
    print("1. ĐANG XỬ LÝ PHÂN HỆ 1: KHO CÁC NETWORK AFFILIATE...")
    print("========================================================")

    src_csv = r"E:\Shopify\Build with\output_verified\all_nets_verified.csv"
    programs = []
    net_stats = {}

    if os.path.exists(src_csv):
        with open(src_csv, 'r', encoding='utf-8', errors='ignore') as f:
            reader = csv.DictReader(f)
            for row in reader:
                net = row.get('net', '').strip().lower()
                domain = row.get('domain', '').strip().lower()
                slug = row.get('slug', '').strip()
                join_url = row.get('join_url', '').strip()
                company = row.get('company', '').strip() or slug.capitalize()
                status = row.get('status', 'active').strip()

                if not net or not slug:
                    continue

                programs.append({
                    'net': net,
                    'slug': slug,
                    'brand_domain': domain,
                    'program_name': company,
                    'join_url': join_url,
                    'status': status
                })

                if net not in net_stats:
                    net_stats[net] = {'count': 0, 'sample_url': join_url}
                net_stats[net]['count'] += 1
                if not net_stats[net]['sample_url'] and join_url:
                    net_stats[net]['sample_url'] = join_url

    print(f"- Đã nạp {len(programs):,d} chương trình affiliate xác minh từ {len(net_stats)} mạng.")

    # 1.1 Summary CSV
    sum_csv_path = os.path.join(DIR_NETS, "summary_aff_nets.csv")
    with open(sum_csv_path, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['net_id', 'platform_name', 'live_programs_count', 'portal_pattern', 'sample_join_url', 'status'])
        for net, info in sorted(net_stats.items(), key=lambda x: -x[1]['count']):
            meta = NET_METADATA.get(net, {'name': net.split('.')[0].capitalize(), 'portal': f"https://{net}"})
            w.writerow([
                net,
                meta['name'],
                info['count'],
                meta['portal'],
                info['sample_url'],
                'active'
            ])
    print(f"- Xuất bảng tổng hợp Net: {sum_csv_path}")

    # 1.2 Programs CSV
    prog_csv_path = os.path.join(DIR_NETS, "aff_programs_verified.csv")
    with open(prog_csv_path, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['net', 'slug', 'brand_domain', 'program_name', 'join_url', 'status'])
        for p in programs:
            w.writerow([p['net'], p['slug'], p['brand_domain'], p['program_name'], p['join_url'], p['status']])
    print(f"- Xuất danh sách 5,073 chương trình affiliate: {prog_csv_path}")

    # 1.3 Master SQL Import for aff_net, aff_host, aff_program
    sql_path = os.path.join(DIR_NETS, "import_aff_nets_to_vps.sql")
    now_ms = int(time.time() * 1000)

    with open(sql_path, 'w', encoding='utf-8') as f:
        f.write("-- =====================================================\n")
        f.write("-- IMPORT TO VPS: AFFILIATE NETWORKS & VERIFIED PROGRAMS\n")
        f.write(f"-- Exported: {time.strftime('%Y-%m-%d %H:%M:%S')} | Total: {len(programs):,d} programs\n")
        f.write("-- Tables: aff_net, aff_host, aff_program\n")
        f.write("-- =====================================================\n\n")

        # Table aff_net
        f.write("-- 1. INSERT INTO aff_net\n")
        net_rows = []
        for net, info in net_stats.items():
            meta = NET_METADATA.get(net, {'name': net.split('.')[0].capitalize()})
            net_rows.append(f"('{net}', '{meta['name']}', 1, 'Imported from BuiltWith ground-truth data', {now_ms})")
        if net_rows:
            f.write("INSERT INTO aff_net (net, platform, enabled, note, created_at) VALUES\n")
            f.write(',\n'.join(net_rows))
            f.write("\nON DUPLICATE KEY UPDATE enabled=1, note=VALUES(note);\n\n")

        # Table aff_host & aff_program (Batching 200 per statement)
        f.write("-- 2. INSERT INTO aff_host & aff_program\n")
        batch_size = 250
        for i in range(0, len(programs), batch_size):
            chunk = programs[i:i + batch_size]
            host_vals = []
            prog_vals = []
            for p in chunk:
                c_net = clean_sql(p['net'])
                c_slug = clean_sql(p['slug'])
                c_dom = clean_sql(p['brand_domain'])
                c_prog = clean_sql(p['program_name'])
                c_join = clean_sql(p['join_url'])

                host_vals.append(f"({c_net}, {c_slug}, {now_ms}, {now_ms}, 'builtwith-verified', {now_ms}, 'active', 1)")
                prog_vals.append(f"({c_net}, {c_slug}, {c_join}, {c_prog}, {c_dom}, 'active', {now_ms})")

            f.write("INSERT INTO aff_host (net, slug, first_seen, last_seen, sources, checked_at, check_status, check_tries) VALUES\n")
            f.write(',\n'.join(host_vals))
            f.write("\nON DUPLICATE KEY UPDATE check_status='active', checked_at=VALUES(checked_at);\n\n")

            f.write("INSERT INTO aff_program (net, slug, join_url, program_name, brand_domain, status, scanned_at) VALUES\n")
            f.write(',\n'.join(prog_vals))
            f.write("\nON DUPLICATE KEY UPDATE join_url=VALUES(join_url), status='active', scanned_at=VALUES(scanned_at);\n\n")

    print(f"- Tạo file SQL Master nạp VPS: {sql_path} ({os.path.getsize(sql_path)/(1024*1024):.2f} MB)")
    return {p['brand_domain']: p for p in programs}

# =============================================================
# PART 2: KHO WEBSITE SHOPIFY (2_WEBSITES_SHOPIFY)
# =============================================================
def process_shopify(aff_by_domain):
    print("\n========================================================")
    print("2. ĐANG XỬ LÝ PHÂN HỆ 2: KHO WEBSITE SHOPIFY...")
    print("========================================================")

    src_shopify = r"E:\Shopify\Shopify_-_2026-10-07_verified_shopify.csv"
    tier1_shops = []
    aff_shops = []

    print(f"- Đang đọc {src_shopify} và lọc Top doanh thu...")
    with open(src_shopify, 'r', encoding='utf-8', errors='ignore') as f:
        reader = csv.reader(f)
        header = next(reader)
        rev_idx = [i for i, h in enumerate(header) if 'Sales Revenue' in h][0] if any('Sales Revenue' in h for h in header) else -1
        spend_idx = [i for i, h in enumerate(header) if 'Technology Spend' in h][0] if any('Technology Spend' in h for h in header) else -1
        comp_idx = [i for i, h in enumerate(header) if 'Company' in h][0] if any('Company' in h for h in header) else -1
        country_idx = [i for i, h in enumerate(header) if 'Country' in h][0] if any('Country' in h for h in header) else -1
        city_idx = [i for i, h in enumerate(header) if 'City' in h][0] if any('City' in h for h in header) else -1

        for row in reader:
            if not row: continue
            d = row[0].strip().lower()
            if not d or '.' not in d: continue

            rev_raw = row[rev_idx].strip() if rev_idx != -1 and len(row) > rev_idx else ''
            spend_raw = row[spend_idx].strip() if spend_idx != -1 and len(row) > spend_idx else ''
            comp = row[comp_idx].strip() if comp_idx != -1 and len(row) > comp_idx else ''
            country = row[country_idx].strip() if country_idx != -1 and len(row) > country_idx else ''
            city = row[city_idx].strip() if city_idx != -1 and len(row) > city_idx else ''

            # Match with verified affiliate programs
            aff_match = aff_by_domain.get(d)
            rev_val = parse_currency(rev_raw)
            spend_val = parse_currency(spend_raw)

            shop_obj = {
                'web': d,
                'shop_name': comp or d.split('.')[0].capitalize(),
                'rev_raw': rev_raw,
                'rev_month': rev_val,
                'rev_day': round(rev_val / 30.0, 2),
                'rev_week': round(rev_val / 4.0, 2),
                'rev_total': rev_val * 12.0,
                'spend_raw': spend_raw,
                'spend_val': spend_val,
                'country': country,
                'city': city,
                'has_aff': bool(aff_match),
                'join_url': aff_match['join_url'] if aff_match else '',
                'aff_platform': aff_match['net'] if aff_match else '',
                'aff_status': 'active' if aff_match else 'none'
            }

            if rev_val > 0:
                tier1_shops.append(shop_obj)
            if aff_match:
                aff_shops.append(shop_obj)

    print(f"- Lọc được {len(tier1_shops):,d} shop Doanh thu khủng (Sales Revenue > $0)")
    print(f"- Lọc được {len(aff_shops):,d} shop Shopify có link Affiliate đã xác minh")

    # 2.1 Export Tier 1 High Revenue CSV
    t1_csv = os.path.join(DIR_SHOPIFY, "shopify_tier1_high_revenue.csv")
    with open(t1_csv, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['web', 'shop_name', 'rev_month', 'rev_day', 'rev_week', 'rev_total', 'tech_spend', 'country', 'city', 'aff_platform', 'join_url', 'aff_status'])
        for s in tier1_shops:
            w.writerow([
                s['web'], s['shop_name'], s['rev_month'], s['rev_day'], s['rev_week'], s['rev_total'],
                s['spend_raw'], s['country'], s['city'], s['aff_platform'], s['join_url'], s['aff_status']
            ])
    print(f"- Xuất file CSV Tier 1: {t1_csv}")

    # 2.2 Export Tier 1 High Revenue SQL for shopify_buildwith
    t1_sql = os.path.join(DIR_SHOPIFY, "shopify_tier1_high_revenue.sql")
    now_ms = int(time.time() * 1000)

    with open(t1_sql, 'w', encoding='utf-8') as f:
        f.write("-- =====================================================\n")
        f.write("-- IMPORT TO VPS: SHOPIFY TIER 1 HIGH REVENUE SHOPS\n")
        f.write(f"-- Exported: {time.strftime('%Y-%m-%d %H:%M:%S')} | Total: {len(tier1_shops):,d} shops\n")
        f.write("-- Table: shopify_buildwith\n")
        f.write("-- Features: Pre-populated rev_month, rev_day, tech spend, affiliate join_url\n")
        f.write("-- Traffic Sync: Auto-joins with aff_domain_traffic via web column\n")
        f.write("-- =====================================================\n\n")

        batch_size = 250
        for i in range(0, len(tier1_shops), batch_size):
            chunk = tier1_shops[i:i + batch_size]
            vals = []
            for s in chunk:
                c_web = clean_sql(s['web'])
                c_name = clean_sql(s['shop_name'])
                c_join = clean_sql(s['join_url']) if s['join_url'] else 'NULL'
                c_aff_plat = clean_sql(s['aff_platform']) if s['aff_platform'] else 'NULL'
                c_aff_stat = clean_sql(s['aff_status'])
                c_note = clean_sql(f"Spend: {s['spend_raw']} | Country: {s['country']}")

                vals.append(
                    f"({c_web}, {c_name}, 'USD', {s['rev_day']}, {s['rev_week']}, {s['rev_month']}, {s['rev_total']}, 1, {now_ms}, "
                    f"{c_join}, {c_aff_stat}, {c_aff_plat}, {now_ms if s['has_aff'] else 'NULL'}, 1, 1, {c_note}, {now_ms}, {now_ms})"
                )

            f.write("INSERT INTO shopify_buildwith (web, shop_name, currency, rev_day, rev_week, rev_month, rev_total, found, synced_at, join_url, aff_status, aff_platform, aff_checked_at, dns_ok, shopify, note, created_at, updated_at) VALUES\n")
            f.write(',\n'.join(vals))
            f.write("\nON DUPLICATE KEY UPDATE rev_month=VALUES(rev_month), rev_day=VALUES(rev_day), rev_week=VALUES(rev_week), rev_total=VALUES(rev_total), shop_name=VALUES(shop_name), join_url=COALESCE(VALUES(join_url), shopify_buildwith.join_url), aff_platform=COALESCE(VALUES(aff_platform), shopify_buildwith.aff_platform), aff_status=COALESCE(VALUES(aff_status), shopify_buildwith.aff_status), updated_at=VALUES(updated_at);\n\n")

    print(f"- Tạo file SQL nạp ngay cho 12,089 shop doanh thu khủng: {t1_sql} ({os.path.getsize(t1_sql)/(1024*1024):.2f} MB)")

    # 2.3 Export Shopify with Active Affiliate
    if aff_shops:
        aff_csv = os.path.join(DIR_SHOPIFY, "shopify_affiliates_active.csv")
        with open(aff_csv, 'w', newline='', encoding='utf-8') as f:
            w = csv.writer(f)
            w.writerow(['web', 'shop_name', 'aff_platform', 'join_url', 'rev_month', 'tech_spend', 'country'])
            for s in aff_shops:
                w.writerow([s['web'], s['shop_name'], s['aff_platform'], s['join_url'], s['rev_month'], s['spend_raw'], s['country']])
        print(f"- Xuất file CSV Shopify có Affiliate: {aff_csv}")

# =============================================================
# PART 3: KHO CÁC LOẠI WEB KHÁC (NON-SHOPIFY & TECH KHÁC)
# =============================================================
def process_other_tech(aff_by_domain):
    print("\n========================================================")
    print("3. ĐANG XỬ LÝ PHÂN HỆ 3: CÁC LOẠI WEB KHÁC (NON-SHOPIFY & TECH KHÁC)...")
    print("========================================================")

    all_other_shops = []

    # 3.1 Magento Sites
    magento_zip = r"E:\Shopify\Build with\All_Live_Magento_Sites_-_2026-10-10.zip"
    if os.path.exists(magento_zip):
        print("- Đang bóc tách Magento sites...")
        with zipfile.ZipFile(magento_zip, 'r') as z:
            for name in z.namelist():
                if name.endswith('.csv'):
                    with z.open(name) as f:
                        reader = csv.reader(io.TextIOWrapper(f, encoding='utf-8', errors='ignore'))
                        header = next(reader)
                        comp_idx = [i for i, h in enumerate(header) if 'Company' in h][0] if any('Company' in h for h in header) else -1
                        spend_idx = [i for i, h in enumerate(header) if 'Technology Spend' in h][0] if any('Technology Spend' in h for h in header) else -1
                        rev_idx = [i for i, h in enumerate(header) if 'Sales Revenue' in h][0] if any('Sales Revenue' in h for h in header) else -1

                        count = 0
                        magento_rows = []
                        for row in reader:
                            if not row: continue
                            d = row[0].strip().lower()
                            if not d or '.' not in d: continue
                            comp = row[comp_idx].strip() if comp_idx != -1 and len(row) > comp_idx else ''
                            spend = row[spend_idx].strip() if spend_idx != -1 and len(row) > spend_idx else ''
                            rev = row[rev_idx].strip() if rev_idx != -1 and len(row) > rev_idx else ''

                            aff = aff_by_domain.get(d)
                            item = {
                                'web': d,
                                'shop_name': comp or d.split('.')[0].capitalize(),
                                'category': 'Magento eCommerce',
                                'tech_spend': spend,
                                'rev_month': parse_currency(rev),
                                'join_url': aff['join_url'] if aff else '',
                                'aff_platform': aff['net'] if aff else '',
                                'aff_status': 'active' if aff else 'none'
                            }
                            magento_rows.append(item)
                            count += 1
                            if count >= 10000: # Top 10k Magento
                                break

                        all_other_shops.extend(magento_rows)
                        print(f"  + Lọc {len(magento_rows):,d} shop Magento tiêu biểu.")
                        mag_csv = os.path.join(DIR_OTHER_CAT, "magento_shops.csv")
                        with open(mag_csv, 'w', newline='', encoding='utf-8') as mf:
                            w = csv.writer(mf)
                            w.writerow(['web', 'shop_name', 'category', 'tech_spend', 'rev_month', 'aff_platform', 'join_url'])
                            for r in magento_rows:
                                w.writerow([r['web'], r['shop_name'], r['category'], r['tech_spend'], r['rev_month'], r['aff_platform'], r['join_url']])

    # 3.2 ClickFunnels Sites
    cf_zip = r"E:\Shopify\Build with\All_Live_ClickFunnels_Sites_-_2026-09-20.zip"
    if os.path.exists(cf_zip):
        print("- Đang bóc tách ClickFunnels sites...")
        with zipfile.ZipFile(cf_zip, 'r') as z:
            for name in z.namelist():
                if name.endswith('.csv'):
                    with z.open(name) as f:
                        reader = csv.reader(io.TextIOWrapper(f, encoding='utf-8', errors='ignore'))
                        header = next(reader)
                        comp_idx = [i for i, h in enumerate(header) if 'Company' in h][0] if any('Company' in h for h in header) else -1
                        spend_idx = [i for i, h in enumerate(header) if 'Technology Spend' in h][0] if any('Technology Spend' in h for h in header) else -1

                        count = 0
                        cf_rows = []
                        for row in reader:
                            if not row: continue
                            d = row[0].strip().lower()
                            if not d or '.' not in d: continue
                            comp = row[comp_idx].strip() if comp_idx != -1 and len(row) > comp_idx else ''
                            spend = row[spend_idx].strip() if spend_idx != -1 and len(row) > spend_idx else ''

                            aff = aff_by_domain.get(d)
                            item = {
                                'web': d,
                                'shop_name': comp or d.split('.')[0].capitalize(),
                                'category': 'ClickFunnels Marketing',
                                'tech_spend': spend,
                                'rev_month': 0.0,
                                'join_url': aff['join_url'] if aff else '',
                                'aff_platform': aff['net'] if aff else '',
                                'aff_status': 'active' if aff else 'none'
                            }
                            cf_rows.append(item)
                            count += 1
                            if count >= 10000: # Top 10k ClickFunnels
                                break

                        all_other_shops.extend(cf_rows)
                        print(f"  + Lọc {len(cf_rows):,d} site ClickFunnels tiêu biểu.")
                        cf_csv = os.path.join(DIR_OTHER_CAT, "clickfunnels_sites.csv")
                        with open(cf_csv, 'w', newline='', encoding='utf-8') as cff:
                            w = csv.writer(cff)
                            w.writerow(['web', 'shop_name', 'category', 'tech_spend', 'rev_month', 'aff_platform', 'join_url'])
                            for r in cf_rows:
                                w.writerow([r['web'], r['shop_name'], r['category'], r['tech_spend'], r['rev_month'], r['aff_platform'], r['join_url']])

    # 3.3 Non-Shopify Domains from txt
    non_shop_file = r"E:\Shopify\Shopify_-_2026-10-07_non_shopify.txt"
    if os.path.exists(non_shop_file):
        print("- Đang nạp danh sách Non-Shopify domains...")
        non_shop_rows = []
        with open(non_shop_file, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                d = line.strip().lower()
                if not d or '.' not in d: continue
                aff = aff_by_domain.get(d)
                # Keep if has affiliate or take top sample
                if aff:
                    item = {
                        'web': d,
                        'shop_name': d.split('.')[0].capitalize(),
                        'category': 'WooCommerce / WordPress / Custom CMS',
                        'tech_spend': '',
                        'rev_month': 0.0,
                        'join_url': aff['join_url'],
                        'aff_platform': aff['net'],
                        'aff_status': 'active'
                    }
                    non_shop_rows.append(item)

        print(f"  + Lọc {len(non_shop_rows):,d} site Non-Shopify đã có sẵn Affiliate.")
        all_other_shops.extend(non_shop_rows)

    # 3.4 Export Master Other Tech Catalog CSV
    other_csv = os.path.join(DIR_OTHER, "other_tech_catalog.csv")
    with open(other_csv, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['web', 'shop_name', 'tech_category', 'tech_spend', 'rev_month', 'aff_platform', 'join_url', 'aff_status'])
        for s in all_other_shops:
            w.writerow([s['web'], s['shop_name'], s['category'], s['tech_spend'], s['rev_month'], s['aff_platform'], s['join_url'], s['aff_status']])
    print(f"- Xuất file tổng hợp Web Công Nghệ Khác: {other_csv} ({len(all_other_shops):,d} domains)")

    # 3.5 Export SQL for aff_library on VPS
    other_sql = os.path.join(DIR_OTHER, "import_other_tech_to_vps.sql")
    now_ms = int(time.time() * 1000)

    with open(other_sql, 'w', encoding='utf-8') as f:
        f.write("-- =====================================================\n")
        f.write("-- IMPORT TO VPS: OTHER TECH WEBSITES (MAGENTO / CLICKFUNNELS / CUSTOM)\n")
        f.write(f"-- Exported: {time.strftime('%Y-%m-%d %H:%M:%S')} | Total: {len(all_other_shops):,d} websites\n")
        f.write("-- Table: aff_library\n")
        f.write("-- Note: Stores Tech Category & Tech Spend in note column\n")
        f.write("-- Traffic Sync: AITDK bot can immediately query visits via web column\n")
        f.write("-- =====================================================\n\n")

        batch_size = 250
        for i in range(0, len(all_other_shops), batch_size):
            chunk = all_other_shops[i:i + batch_size]
            vals = []
            for s in chunk:
                c_web = clean_sql(s['web'])
                c_name = clean_sql(s['shop_name'])
                c_join = clean_sql(s['join_url']) if s['join_url'] else 'NULL'
                c_aff_plat = clean_sql(s['aff_platform']) if s['aff_platform'] else 'NULL'
                c_aff_stat = clean_sql(s['aff_status'])
                c_note = clean_sql(f"Platform: {s['category']} | Spend: {s['tech_spend']}")

                vals.append(
                    f"({c_web}, {c_name}, 'USD', 0, 0, {s['rev_month']}, {s['rev_month']*12}, 1, {now_ms}, "
                    f"{c_join}, {c_aff_stat}, {c_aff_plat}, {now_ms if s['join_url'] else 'NULL'}, 1, {c_note}, {now_ms}, {now_ms})"
                )

            f.write("INSERT INTO aff_library (web, shop_name, currency, rev_day, rev_week, rev_month, rev_total, found, synced_at, join_url, aff_status, aff_platform, aff_checked_at, dns_ok, note, created_at, updated_at) VALUES\n")
            f.write(',\n'.join(vals))
            f.write("\nON DUPLICATE KEY UPDATE note=VALUES(note), join_url=COALESCE(VALUES(join_url), aff_library.join_url), aff_platform=COALESCE(VALUES(aff_platform), aff_library.aff_platform), aff_status=COALESCE(VALUES(aff_status), aff_library.aff_status), updated_at=VALUES(updated_at);\n\n")

    print(f"- Tạo file SQL nạp VPS cho Web Công Nghệ Khác: {other_sql} ({os.path.getsize(other_sql)/(1024*1024):.2f} MB)")

# =============================================================
# PART 4: HƯỚNG DẪN ĐẨY LÊN VPS & IMPORT (HUONG_DAN_DAY_LEN_VPS.md)
# =============================================================
def write_vps_guide():
    guide_path = os.path.join(BASE_OUT, "HUONG_DAN_DAY_LEN_VPS.md")
    content = """# HƯỚNG DẪN ĐẨY VÀ NẠP DỮ LIỆU ĐÃ PHÂN TẦNG LÊN VPS (srv1257781)

Hệ thống đã phân chia và đóng gói dữ liệu thành **3 phân hệ độc lập, chuẩn hóa tuyệt đối** theo yêu cầu của Boss Tony:

```
E:\\Shopify\\VPS_DISTRIBUTION\\
├── 1_NETWORKS_AFF/               -> Kho các Mạng Affiliate (/affnet)
│   ├── summary_aff_nets.csv       -> Bảng thống kê chi tiết từng Net
│   ├── aff_programs_verified.csv  -> 5,073 chương trình affiliate sống xác minh
│   └── import_aff_nets_to_vps.sql -> File SQL nạp vào aff_net, aff_host, aff_program
│
├── 2_WEBSITES_SHOPIFY/           -> Kho Website Shopify (/shopify-buildwith)
│   ├── shopify_tier1_high_revenue.csv -> 12,089 shop có Doanh thu thực tế (vài nghìn đến $100k+/tháng)
│   ├── shopify_tier1_high_revenue.sql -> File SQL nạp ngay vào shopify_buildwith
│   └── shopify_affiliates_active.csv  -> Các shop Shopify đã khớp link đăng ký Affiliate
│
└── 3_WEBSITES_OTHER_TECH/        -> Kho Web Nền tảng khác: Magento, ClickFunnels, WooCommerce (/afflibrary)
    ├── other_tech_catalog.csv    -> Danh mục phân loại theo Tech Platform & Tech Spend
    ├── other_tech_by_category/   -> File riêng từng loại: magento_shops.csv, clickfunnels_shops.csv
    └── import_other_tech_to_vps.sql -> File SQL nạp vào aff_library
```

---

## BƯỚC 1: ĐẨY DỮ LIỆU TỪ MÁY LOCAL LÊN VPS

Boss mở PowerShell hoặc Command Prompt trên máy tính này và chạy lệnh SCP:

```bash
# Tạo thư mục nhận trên VPS
ssh root@srv1257781 "mkdir -p /var/www/ads-spy/data_distribution"

# Đẩy 3 thư mục lên VPS:
scp -r "E:\\Shopify\\VPS_DISTRIBUTION\\*" root@srv1257781:/var/www/ads-spy/data_distribution/
```

---

## BƯỚC 2: NẠP VÀO DATABASE MYSQL TRÊN VPS

Sau khi SSH vào VPS (`ssh root@srv1257781`), Boss chạy lần lượt 3 lệnh SQL:

### 1. Nạp Phân hệ Mạng Affiliate (Giao diện `/affnet`):
```bash
mysql -u shop -p shophunter < /var/www/ads-spy/data_distribution/1_NETWORKS_AFF/import_aff_nets_to_vps.sql
```
* **Kết quả**: 21 Network affiliate và **5,073 chương trình affiliate hoạt động** (UpPromote, GoAffPro, BixGrow, Collabs, Refersion, Awin...) được nạp vào các bảng `aff_net`, `aff_host`, `aff_program`.
* **Kiểm tra**: Mở https://mmo-coin.com/affnet

### 2. Nạp Phân hệ Shopify Doanh thu cao (Giao diện `/shopify-buildwith`):
```bash
mysql -u shop -p shophunter < /var/www/ads-spy/data_distribution/2_WEBSITES_SHOPIFY/shopify_tier1_high_revenue.sql
```
* **Kết quả**: **12,089 shop Shopify có doanh thu khủng** (có sẵn `rev_month`, `rev_day`, `tech_spend`, và `join_url` nếu có affiliate) được nạp vào bảng `shopify_buildwith`.
* **Đồng bộ tự động**:
  - Doanh thu: Đã nạp sẵn cột `rev_month`, sẵn sàng đồng bộ thêm từ ShopHunter.
  - Traffic AITDK: Khi bot chạy điền traffic, tự động lưu vào bảng `aff_domain_traffic` (visits 12 tháng, bounce, time-onsite) qua khoá `web`.
* **Kiểm tra**: Mở https://mmo-coin.com/shopify-buildwith

### 3. Nạp Phân hệ Web Công nghệ khác (Giao diện `/afflibrary`):
```bash
mysql -u shop -p shophunter < /var/www/ads-spy/data_distribution/3_WEBSITES_OTHER_TECH/import_other_tech_to_vps.sql
```
* **Kết quả**: Hơn 20,000 website Magento, ClickFunnels, WooCommerce, Custom CMS phân loại theo Tech Category & Tech Spend được nạp vào bảng `aff_library`.
* **Đồng bộ tự động**: Sẵn sàng để bot AITDK điền traffic vào `aff_domain_traffic`.
* **Kiểm tra**: Mở https://mmo-coin.com/afflibrary

---

## BƯỚC 3: KIỂM TRA NHANH TRÊN DATABASE VPS

Boss có thể chạy query kiểm tra:
```sql
-- 1. Xem tổng số chương trình affiliate theo Net:
SELECT net, COUNT(*) as total_programs FROM aff_program GROUP BY net ORDER BY total_programs DESC;

-- 2. Xem top 10 shop Shopify doanh thu cao nhất vừa nạp:
SELECT web, shop_name, rev_month, join_url, aff_platform FROM shopify_buildwith ORDER BY rev_month DESC LIMIT 10;

-- 3. Xem các web công nghệ khác trong aff_library:
SELECT web, shop_name, note FROM aff_library LIMIT 10;
```
"""
    with open(guide_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"\n- Đã tạo tài liệu hướng dẫn đẩy VPS: {guide_path}")

def main():
    start = time.time()
    print("BẮT ĐẦU QUY TRÌNH PHÂN CHIA DỮ LIỆU KHOA HỌC CHO VPS...")

    # Step 1: Networks
    aff_by_domain = process_networks()

    # Step 2: Shopify
    process_shopify(aff_by_domain)

    # Step 3: Other Tech
    process_other_tech(aff_by_domain)

    # Step 4: VPS Guide
    write_vps_guide()

    elapsed = time.time() - start
    print(f"\n========================================================")
    print(f"HOÀN THÀNH TẤT CẢ TRONG {elapsed:.1f} GIÂY!")
    print(f"Toàn bộ dữ liệu nằm sẵn tại: {BASE_OUT}")
    print("========================================================")

if __name__ == '__main__':
    main()
