import sys
import os
import csv
import zipfile
import io

sys.stdout.reconfigure(encoding='utf-8')

# Reference sets
print("Đang nạp 560k Shopify verified...")
set_560k = set()
with open(r'E:\Shopify\Shopify_-_2026-10-07_verified_shopify.csv', 'r', encoding='utf-8', errors='ignore') as f:
    next(f)
    for l in f:
        p = l.split(',', 1)[0].strip().lower()
        if p: set_560k.add(p)

print("Đang nạp 718k Alive unique...")
set_718k = set()
with open(r'E:\Shopify\Shopify_-_2026-10-07_alive_unique.csv', 'r', encoding='utf-8', errors='ignore') as f:
    next(f)
    for l in f:
        p = l.split(',', 1)[0].strip().lower()
        if p: set_718k.add(p)

# G:\AFF 20 domains
g_aff = {'aala.shop', 'arvanes.myshopify.com', 'artwalkingstick.com', 'allguardcarcare.com', 'amalfigiorno.com', 'agentnateur.mom', 'aktarelit.com', 'aislpc.de', 'alkalineherbpartners.com', 'anoricosmetics.dk', 'advanceddentistryofsandiego.com', 'afx-holdings.com', 'airtieco.com', 'almondsurfboards.mom', 'alessi.live', 'artwalkingcanes.com', '26587u-ta.myshopify.com', 'apothekeco.live', 'airdoctor.com', 'apricotton.store'}

in_560 = g_aff.intersection(set_560k)
in_718 = g_aff.intersection(set_718k)
print(f"G:\\AFF 20 domains trong 560k: {len(in_560)}/20")
print(f"G:\\AFF 20 domains trong 718k: {len(in_718)}/20")

# Verified programs in output_verified
verified_map = {}
v_csv = r'E:\Shopify\Build with\output_verified\all_nets_verified.csv'
if os.path.exists(v_csv):
    with open(v_csv, 'r', encoding='utf-8', errors='ignore') as f:
        r = csv.DictReader(f)
        for row in r:
            net = row['net']
            d = row['domain']
            if net not in verified_map: verified_map[net] = []
            verified_map[net].append(row)

# Mapping of the 21 Networks to zip files
NET_ZIPS = [
    ('uppromote.com', ['All_Live_UpPromote_Sites_-_2026-09-17.zip', 'All_Live_Secomapp_Sites_-_2026-09-20.zip']),
    ('goaffpro.com', ['All_Live_GoAffPro_Sites_-_2026-09-17.zip']),
    ('rakuten.com', ['All_Live_Rakuten_Affiliate_Sites_-_2026-09-17.zip', 'All_Live_Rakuten_Advertising_Sites_-_2026-09-17.zip']),
    ('awin.com', ['All_Live_AWIN_Sites_-_2026-10-03.zip']),
    ('impact.com', ['All_Live_Impact_Sites_-_2026-09-17.zip']),
    ('getrewardful.com', ['All_Live_Rewardful_Sites_-_2026-09-17.zip']),
    ('affiliatly.com', ['All_Live_Affiliatly_Sites_-_2026-09-20.zip']),
    ('firstpromoter.com', ['All_Live_FirstPromoter_Sites_-_2026-09-18.zip']),
    ('postaffiliatepro.com', ['All_Live_Post_Affiliate_Pro_Sites_-_2026-09-17.zip']),
    ('socialsnowball.io', ['All_Live_Social_Snowball_Sites_-_2026-09-17.zip']),
    ('collabs.shopify.com', ['All_Live_Shopify_Collabs_Sites_-_2026-09-17.zip']),
    ('refersion.com', ['All_Live_Refersion_Sites_-_2026-09-17.zip']),
    ('tolt.io', ['All_Live_Tolt_Sites_-_2026-09-17.zip']),
    ('promotekit.com', ['All_Live_PromoteKit_Sites_-_2026-09-19.zip']),
    ('dub.co', ['All_Live_Dub_Sites_-_2026-09-17.zip']),
    ('partnerstack.com', ['All_Live_PartnerStack_Sites_-_2026-09-29.zip']),
    ('bixgrow.com', ['All_Live_BixGrow_Sites_-_2026-10-05.zip']),
    ('superfiliate.com', ['All_Live_Superfiliate_Sites_-_2026-09-17.zip']),
    ('affilimate.com', ['All_Live_Affilimate_Sites_-_2026-09-17.zip']),
    ('cuelinks.com', ['All_Live_CueLinks_Sites_-_2026-09-17.zip']),
    ('partnerboost.com', ['All_Live_PartnerBoost_Sites_-_2026-09-17.zip'])
]

bw_dir = r'E:\Shopify\Build with'
print('\n' + '='*105)
header = f"{'#':<3} | {'Tên Network':<20} | {'Tổng Zip':<10} | {'Khớp 560k':<10} | {'Khớp 718k':<10} | {'Đã Verified Aff':<16} | {'Khớp G:AFF'}"
print(header)
print('-'*105)

total_zip_all = 0
total_in_560 = 0
total_in_718 = 0
total_verified = 0

all_unique_net_domains = set()

for idx, (net, zips) in enumerate(NET_ZIPS, 1):
    net_domains = set()
    for zname in zips:
        zp = os.path.join(bw_dir, zname)
        if os.path.exists(zp):
            with zipfile.ZipFile(zp, 'r') as z:
                for fname in z.namelist():
                    if fname.endswith('.csv'):
                        with z.open(fname) as zf:
                            for line in io.TextIOWrapper(zf, encoding='utf-8', errors='ignore'):
                                d = line.split(',', 1)[0].strip().lower()
                                if d and '.' in d and not d.startswith('root domain'):
                                    net_domains.add(d)

    all_unique_net_domains.update(net_domains)
    in_560k_cnt = len(net_domains.intersection(set_560k))
    in_718k_cnt = len(net_domains.intersection(set_718k))
    v_cnt = len(verified_map.get(net, []))
    g_match = len(net_domains.intersection(g_aff))

    total_zip_all += len(net_domains)
    total_in_560 += in_560k_cnt
    total_in_718 += in_718k_cnt
    total_verified += v_cnt

    print(f"#{idx:02d} | {net:<20} | {len(net_domains):<10,d} | {in_560k_cnt:<10,d} | {in_718k_cnt:<10,d} | {v_cnt:<16,d} | {g_match}")

print('-'*105)
print(f"TỔNG (Cộng dồn từng Net): | {total_zip_all:<10,d} | {total_in_560:<10,d} | {total_in_718:<10,d} | {total_verified:<16,d}")
print(f"TỔNG DUY NHẤT (Unique):   | {len(all_unique_net_domains):<10,d} | {len(all_unique_net_domains.intersection(set_560k)):<10,d} | {len(all_unique_net_domains.intersection(set_718k)):<10,d} | {total_verified:<16,d}")
print('='*105)
