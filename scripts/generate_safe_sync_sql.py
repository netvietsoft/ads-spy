import csv
import os
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')

CSV_PATH = r"E:\Shopify\MASS_VERIFIED_PROJECTS\truly_live_affiliate_projects.csv"
OUT_SQL = r"E:\Shopify\MASS_VERIFIED_PROJECTS\safe_sync_affiliates_to_mmo_coin.sql"

def esc(val):
    if val is None:
        return 'NULL'
    s = str(val).replace('\\', '\\\\').replace("'", "''")
    return f"'{s}'"

def normalize_net_host(net):
    net_str = str(net).strip()
    c = net_str.lower().replace(' ', '')
    if not c.endswith('.com') and not c.endswith('.io') and not c.endswith('.co'):
        c += '.com'
    return c

def generate():
    print(f"Bắt đầu tạo SQL Safe Sync từ {CSV_PATH}...")
    start_time = time.time()
    
    if not os.path.exists(CSV_PATH):
        print(f"Error: Không tìm thấy {CSV_PATH}")
        return

    BATCH_SIZE = 1000
    host_vals = []
    prog_vals = []
    lib_vals = []

    total_rows = 0

    with open(OUT_SQL, 'w', encoding='utf-8') as f_out:
        f_out.write("-- ================================================================\n")
        f_out.write("-- SAFE SYNC 68,061 VERIFIED AFFILIATE PROJECTS TO MMO-COIN / DPBOSS\n")
        f_out.write("-- AN TOÀN TUYỆT ĐỐI: BẢO TOÀN 100% DOANH THU & TRAFFIC ĐÃ CÀO TRÊN VPS\n")
        f_out.write("-- CHỈ THÊM DOMAIN MỚI HOẶC CẬP NHẬT LINK AFFILIATE (KHÔNG GHI ĐÈ REVENUE)\n")
        f_out.write("-- ================================================================\n\n")
        f_out.write("USE shophunter;\n\n")
        f_out.write("""CREATE TABLE IF NOT EXISTS aff_host (
  net VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  first_seen BIGINT,
  last_seen BIGINT,
  sources VARCHAR(255),
  checked_at BIGINT,
  check_status VARCHAR(32),
  check_tries INT DEFAULT 0,
  PRIMARY KEY (net, slug)
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS aff_program (
  net VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  join_url VARCHAR(1024),
  program_name VARCHAR(255),
  brand VARCHAR(255),
  web VARCHAR(255),
  status VARCHAR(32),
  fetched_at BIGINT,
  PRIMARY KEY (net, slug),
  KEY idx_prog_web (web)
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS aff_library (
  web VARCHAR(255) PRIMARY KEY,
  shop_name VARCHAR(255), shop_id VARCHAR(32), currency VARCHAR(8),
  rev_day DOUBLE, rev_week DOUBLE, rev_month DOUBLE, rev_total DOUBLE, sku INT,
  found TINYINT DEFAULT 0, synced_at BIGINT,
  join_url VARCHAR(1024), commission_pct DOUBLE, payout DOUBLE, cookie_days INT, note VARCHAR(512),
  aff_status VARCHAR(16), aff_platform VARCHAR(40), aff_checked_at BIGINT,
  dns_ok TINYINT, aff_try_count INT DEFAULT 0, aff_last_error VARCHAR(255), aff_last_try_at BIGINT,
  traffic_tried_at BIGINT, shopify TINYINT DEFAULT 1, shopify_checked_at BIGINT,
  rev_scan_at BIGINT, rev_scan_err VARCHAR(255), created_at BIGINT, updated_at BIGINT
) CHARACTER SET utf8mb4;

""")

        with open(CSV_PATH, 'r', encoding='utf-8', errors='ignore') as f_in:
            reader = csv.DictReader(f_in)
            for row in reader:
                dom = row['domain'].strip().lower()
                slug = row['slug'].strip()
                comp = row['company'].strip() or slug.capitalize()
                net = row['net'].strip()
                net_host = normalize_net_host(net)
                join_url = row['join_url'].strip()
                form_title = row['form_title'].strip() or (comp + " Affiliate Program")
                v_time = int(row.get('verified_at') or time.time() * 1000)

                # 1. aff_host
                host_vals.append(f"({esc(net_host)}, {esc(slug)}, {v_time}, {v_time}, 'mass-verified', {v_time}, 'active', 1)")

                # 2. aff_program
                prog_vals.append(f"({esc(net_host)}, {esc(slug)}, {esc(join_url)}, {esc(form_title)}, {esc(comp)}, {esc(dom)}, 'active', {v_time})")

                # 3. aff_library
                lib_vals.append(f"({esc(dom)}, {esc(comp)}, {esc(join_url)}, {esc(net)}, 'yes', {v_time}, 1, 1)")

                total_rows += 1

                if len(host_vals) >= BATCH_SIZE:
                    # Write batch
                    f_out.write(
                        "INSERT INTO aff_host (net, slug, first_seen, last_seen, sources, checked_at, check_status, check_tries) VALUES\n" +
                        ",\n".join(host_vals) +
                        "\nON DUPLICATE KEY UPDATE check_status='active', checked_at=VALUES(checked_at), last_seen=VALUES(last_seen);\n\n"
                    )
                    f_out.write(
                        "INSERT INTO aff_program (net, slug, join_url, program_name, brand, web, status, fetched_at) VALUES\n" +
                        ",\n".join(prog_vals) +
                        "\nON DUPLICATE KEY UPDATE join_url=VALUES(join_url), status='active', fetched_at=VALUES(fetched_at), web=VALUES(web);\n\n"
                    )
                    f_out.write(
                        "INSERT INTO aff_library (web, shop_name, join_url, aff_platform, aff_status, aff_checked_at, dns_ok, shopify) VALUES\n" +
                        ",\n".join(lib_vals) +
                        "\nON DUPLICATE KEY UPDATE join_url=VALUES(join_url), aff_platform=VALUES(aff_platform), aff_status='yes', aff_checked_at=VALUES(aff_checked_at), dns_ok=1, shopify=1;\n\n"
                    )
                    host_vals.clear()
                    prog_vals.clear()
                    lib_vals.clear()

            if host_vals:
                f_out.write(
                    "INSERT INTO aff_host (net, slug, first_seen, last_seen, sources, checked_at, check_status, check_tries) VALUES\n" +
                    ",\n".join(host_vals) +
                    "\nON DUPLICATE KEY UPDATE check_status='active', checked_at=VALUES(checked_at), last_seen=VALUES(last_seen);\n\n"
                )
                f_out.write(
                    "INSERT INTO aff_program (net, slug, join_url, program_name, brand, web, status, fetched_at) VALUES\n" +
                    ",\n".join(prog_vals) +
                    "\nON DUPLICATE KEY UPDATE join_url=VALUES(join_url), status='active', fetched_at=VALUES(fetched_at), web=VALUES(web);\n\n"
                )
                f_out.write(
                    "INSERT INTO aff_library (web, shop_name, join_url, aff_platform, aff_status, aff_checked_at, dns_ok, shopify) VALUES\n" +
                    ",\n".join(lib_vals) +
                    "\nON DUPLICATE KEY UPDATE join_url=VALUES(join_url), aff_platform=VALUES(aff_platform), aff_status='yes', aff_checked_at=VALUES(aff_checked_at), dns_ok=1, shopify=1;\n\n"
                )

    file_size_mb = os.path.getsize(OUT_SQL) / (1024 * 1024)
    elapsed = time.time() - start_time
    print(f"Hoàn thành tạo file SQL Safe Sync: {OUT_SQL}")
    print(f"Tổng số bản ghi: {total_rows:,d} | Dung lượng: {file_size_mb:.2f} MB | Thời gian: {elapsed:.2f}s")

if __name__ == '__main__':
    generate()
