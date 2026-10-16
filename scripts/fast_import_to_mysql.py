import csv
import os
import sys
import subprocess
import time

sys.stdout.reconfigure(encoding='utf-8')

CSV_PATH = r"E:\Shopify\MASS_VERIFIED_PROJECTS\truly_live_affiliate_projects.csv"
MYSQL_BIN = r"D:\SetupC\laragon\bin\mysql\mysql-8.4.3-winx64\bin\mysql.exe"

def esc(val):
    if val is None:
        return 'NULL'
    s = str(val).replace('\\', '\\\\').replace("'", "''")
    return f"'{s}'"

def parse_rev(rev_str):
    if not rev_str or rev_str == '$0':
        return 'NULL'
    try:
        clean = rev_str.replace('$', '').replace(',', '').strip()
        val = float(clean)
        return str(val) if val > 0 else 'NULL'
    except:
        return 'NULL'

def normalize_net_host(net):
    net_str = str(net).strip()
    c = net_str.lower().replace(' ', '')
    if not c.endswith('.com') and not c.endswith('.io') and not c.endswith('.co'):
        c += '.com'
    return c

def run_import():
    print(f"=== BẮT ĐẦU IMPORT 68,061 DỰ ÁN AFFILIATE VÀO MYSQL (SHOPHUNTER) ===")
    start_time = time.time()
    
    if not os.path.exists(CSV_PATH):
        print(f"Error: Không tìm thấy file {CSV_PATH}")
        return

    # Check mysql connection
    chk = subprocess.run([MYSQL_BIN, "-u", "root", "-e", "SELECT 1;"], capture_output=True, text=True)
    if chk.returncode != 0:
        print(f"Error: Không thể kết nối MySQL qua {MYSQL_BIN}: {chk.stderr}")
        return

    proc = subprocess.Popen(
        [MYSQL_BIN, "-u", "root", "--default-character-set=utf8mb4", "shophunter"],
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
        encoding='utf-8'
    )

    BATCH_SIZE = 1000
    host_vals = []
    prog_vals = []
    lib_vals = []
    
    total_processed = 0

    with open(CSV_PATH, 'r', encoding='utf-8', errors='ignore') as f:
        reader = csv.DictReader(f)
        for row in reader:
            dom = row['domain'].strip().lower()
            slug = row['slug'].strip()
            comp = row['company'].strip() or slug.capitalize()
            net = row['net'].strip()
            net_host = normalize_net_host(net)
            rev_raw = row['revenue'].strip()
            rev_val = parse_rev(rev_raw)
            join_url = row['join_url'].strip()
            form_title = row['form_title'].strip() or (comp + " Affiliate Program")
            v_time = int(row.get('verified_at') or time.time() * 1000)

            # 1. aff_host
            host_vals.append(f"({esc(net_host)}, {esc(slug)}, {v_time}, {v_time}, 'mass-verified', {v_time}, 'active', 1)")

            # 2. aff_program
            prog_vals.append(f"({esc(net_host)}, {esc(slug)}, {esc(join_url)}, {esc(form_title)}, {esc(comp)}, {esc(dom)}, 'active', {v_time})")

            # 3. aff_library
            lib_vals.append(f"({esc(dom)}, {esc(comp)}, {esc(join_url)}, {esc(net)}, 'active', {v_time}, 1, 1, {rev_val})")

            total_processed += 1

            if len(host_vals) >= BATCH_SIZE:
                sql_chunk = (
                    "INSERT INTO aff_host (net, slug, first_seen, last_seen, sources, checked_at, check_status, check_tries) VALUES\n" +
                    ",\n".join(host_vals) +
                    "\nON DUPLICATE KEY UPDATE check_status='active', checked_at=VALUES(checked_at), last_seen=VALUES(last_seen);\n\n" +
                    "INSERT INTO aff_program (net, slug, join_url, program_name, brand, web, status, fetched_at) VALUES\n" +
                    ",\n".join(prog_vals) +
                    "\nON DUPLICATE KEY UPDATE join_url=VALUES(join_url), status='active', fetched_at=VALUES(fetched_at), web=VALUES(web), brand=VALUES(brand);\n\n" +
                    "INSERT INTO aff_library (web, shop_name, join_url, aff_platform, aff_status, aff_checked_at, dns_ok, shopify, rev_month) VALUES\n" +
                    ",\n".join(lib_vals) +
                    "\nON DUPLICATE KEY UPDATE join_url=VALUES(join_url), aff_platform=VALUES(aff_platform), aff_status='active', aff_checked_at=VALUES(aff_checked_at), dns_ok=1, shopify=1, rev_month=COALESCE(VALUES(rev_month), rev_month);\n\n"
                )
                proc.stdin.write(sql_chunk)
                proc.stdin.flush()
                host_vals = []
                prog_vals = []
                lib_vals = []
                if total_processed % 10000 == 0:
                    print(f"-> Đã nạp: {total_processed:,d} / 68,061 dòng...")

        if host_vals:
            sql_chunk = (
                "INSERT INTO aff_host (net, slug, first_seen, last_seen, sources, checked_at, check_status, check_tries) VALUES\n" +
                ",\n".join(host_vals) +
                "\nON DUPLICATE KEY UPDATE check_status='active', checked_at=VALUES(checked_at), last_seen=VALUES(last_seen);\n\n" +
                "INSERT INTO aff_program (net, slug, join_url, program_name, brand, web, status, fetched_at) VALUES\n" +
                ",\n".join(prog_vals) +
                "\nON DUPLICATE KEY UPDATE join_url=VALUES(join_url), status='active', fetched_at=VALUES(fetched_at), web=VALUES(web), brand=VALUES(brand);\n\n" +
                "INSERT INTO aff_library (web, shop_name, join_url, aff_platform, aff_status, aff_checked_at, dns_ok, shopify, rev_month) VALUES\n" +
                ",\n".join(lib_vals) +
                "\nON DUPLICATE KEY UPDATE join_url=VALUES(join_url), aff_platform=VALUES(aff_platform), aff_status='active', aff_checked_at=VALUES(aff_checked_at), dns_ok=1, shopify=1, rev_month=COALESCE(VALUES(rev_month), rev_month);\n\n"
            )
            proc.stdin.write(sql_chunk)
            proc.stdin.flush()

    proc.stdin.close()
    proc.wait()

    elapsed = time.time() - start_time
    print(f"\n==========================================================================")
    print(f"HOÀN TẤT IMPORT THÀNH CÔNG {total_processed:,d} DỰ ÁN TRONG {elapsed:.1f} GIÂY!")
    if proc.returncode != 0:
        print(f"Cảnh báo stderr: {proc.stderr.read()}")
    print("==========================================================================")

if __name__ == '__main__':
    run_import()
