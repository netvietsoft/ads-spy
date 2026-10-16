import asyncio
import aiohttp
import csv
import os
import sys
import time
import re
import socket

sys.stdout.reconfigure(encoding='utf-8')

# Output files
OUT_DIR = r"E:\Shopify\MASS_VERIFIED_PROJECTS"
os.makedirs(OUT_DIR, exist_ok=True)

CSV_FILE = os.path.join(OUT_DIR, "truly_live_affiliate_projects.csv")
SQL_FILE = os.path.join(OUT_DIR, "import_truly_live_projects.sql")

# Signatures for detection
NET_PATTERNS = [
    ('UpPromote', re.compile(r'uppromote|secomapp|af\.uppromote\.com', re.I)),
    ('GoAffPro', re.compile(r'goaffpro|api\.goaffpro\.com', re.I)),
    ('Shopify Collabs', re.compile(r'collabs\.shopify|join\.collabs\.shopify', re.I)),
    ('Social Snowball', re.compile(r'socialsnowball|social-snowball', re.I)),
    ('BixGrow', re.compile(r'bixgrow', re.I)),
    ('Refersion', re.compile(r'refersion', re.I)),
    ('Affiliatly', re.compile(r'affiliatly', re.I)),
    ('Superfiliate', re.compile(r'superfiliate', re.I)),
    ('Rewardful', re.compile(r'rewardful|r\.wdfl\.co', re.I)),
    ('FirstPromoter', re.compile(r'firstpromoter|\$fprom', re.I)),
    ('Impact', re.compile(r'impact\.com|impactradius', re.I)),
    ('AWIN', re.compile(r'awin\.com', re.I)),
    ('Rakuten', re.compile(r'rakuten|linkshare', re.I)),
    ('Post Affiliate Pro', re.compile(r'postaffiliatepro', re.I)),
    ('LeadDyno', re.compile(r'leaddyno', re.I)),
    ('Tolt', re.compile(r'tolt\.io', re.I)),
    ('PromoteKit', re.compile(r'promotekit', re.I)),
    ('PartnerStack', re.compile(r'partnerstack', re.I))
]

# Strict affiliate keywords for links
AFF_LINK_KEYWORDS = ['affiliate', 'ambassador', 'creator-program', 'partner-program', 'collabs', 'referral-program']

# Disallowed paths (products, carts, accounts)
BAD_PATH_SEGMENTS = ['/products/', '/collections/', '/cart', '/checkout', '/account', '/policies/', '/search', '/cdn/']
IGNORE_DOMAINS = ['facebook.com', 'instagram.com', 'twitter.com', 'tiktok.com', 'pinterest.com', 'youtube.com', 'linkedin.com', 'google.com', 'shopify.com/legal', 'apple.com']

# Strong content indicators that prove this is an affiliate registration/program page
STRONG_CONTENT_INDICATORS = [
    'affiliate program', 'ambassador program', 'creator program', 'partner program',
    'earn commission', 'commission rate', 'cookie duration', 'referral link',
    'affiliate sign up', 'affiliate registration', 'apply to become an affiliate',
    'join our affiliate', 'join our team of ambassadors', 'af.uppromote.com',
    'goaffpro.com', 'bixgrow.com', 'collabs.shopify.com', 'refersion.com'
]

KNOWN_ALIVE = set()
if os.path.exists(CSV_FILE):
    try:
        with open(CSV_FILE, 'r', encoding='utf-8', errors='ignore') as f:
            r = csv.DictReader(f)
            for row in r:
                KNOWN_ALIVE.add(row['domain'].lower().strip())
    except:
        pass

dns_executor = None

async def verify_domain(session, item, sem):
    global dns_executor
    if dns_executor is None:
        import concurrent.futures
        dns_executor = concurrent.futures.ThreadPoolExecutor(max_workers=100)

    domain = item['domain']
    if domain in KNOWN_ALIVE:
        return None

    slug = domain.split('.')[0]
    out = {
        'domain': domain,
        'slug': slug,
        'company': item.get('company') or slug.capitalize(),
        'net': item.get('net') or 'In-house/Direct',
        'revenue': item.get('revenue', ''),
        'spend': item.get('spend', ''),
        'join_url': None,
        'form_title': '',
        'is_live_project': False,
        'http_status': 0
    }

    loop = asyncio.get_running_loop()
    # 1. Fast DNS pre-check
    try:
        await loop.run_in_executor(dns_executor, socket.gethostbyname, domain)
    except:
        return None

    async with sem:
        # 2. Probe Homepage
        homepage_html = ''
        try:
            async with session.get(f"https://{domain}", timeout=aiohttp.ClientTimeout(total=4), ssl=False, allow_redirects=True) as resp:
                out['http_status'] = resp.status
                if resp.status < 400:
                    homepage_html = await resp.text(errors='ignore')
                    
                    # Detect Net from HTML
                    for n_name, pat in NET_PATTERNS:
                        if pat.search(homepage_html):
                            out['net'] = n_name
                            break

                    # Look for real affiliate links in HTML
                    links = re.findall(r'href=["\']([^"\']+)["\']', homepage_html, re.I)
                    for l in links:
                        l_low = l.lower()
                        # Avoid bad path segments (products, collections, cart, etc.)
                        if any(bad in l_low for bad in BAD_PATH_SEGMENTS):
                            continue
                        if any(l_low.endswith(ext) or f"{ext}?" in l_low for ext in ['.css', '.js', '.png', '.jpg', '.jpeg', '.svg', '.gif', '.webp']):
                            continue
                        if any(kw in l_low for kw in AFF_LINK_KEYWORDS):
                            if not any(ign in l_low for ign in IGNORE_DOMAINS) and not l_low.startswith('#') and not l_low.startswith('javascript:'):
                                full = l if l.startswith('http') else f"https://{domain}{'' if l.startswith('/') else '/'}{l}"
                                out['join_url'] = full
                                break
        except:
            pass

        # 3. If no link on homepage, probe standard affiliate paths ONLY IF homepage was alive
        if not out['join_url'] and homepage_html:
            for p in ['/pages/affiliate', '/pages/affiliates', '/pages/collabs']:
                try:
                    probe_url = f"https://{domain}{p}"
                    async with session.get(probe_url, timeout=aiohttp.ClientTimeout(total=2.5), ssl=False, allow_redirects=True) as p_resp:
                        if p_resp.status < 400 and '/password' not in str(p_resp.url):
                            p_html = await p_resp.text(errors='ignore')
                            if any(k in p_html.lower() for k in STRONG_CONTENT_INDICATORS):
                                out['join_url'] = str(p_resp.url)
                                for n_name, pat in NET_PATTERNS:
                                    if pat.search(p_html):
                                        out['net'] = n_name
                                        break
                                break
                except:
                    pass

        # 4. Canonical portals probe if net is known and still no link
        if not out['join_url']:
            if out['net'] == 'UpPromote':
                for p_url in [f"https://af.uppromote.com/{slug}/register", f"https://af.uppromote.com/{slug}"]:
                    try:
                        async with session.get(p_url, timeout=aiohttp.ClientTimeout(total=3), ssl=False, allow_redirects=True) as af_resp:
                            if af_resp.status == 200:
                                out['join_url'] = str(af_resp.url)
                                break
                    except:
                        pass
            elif out['net'] == 'GoAffPro':
                for p_url in [f"https://{slug}.goaffpro.com/create-account", f"https://{slug}.goaffpro.com"]:
                    try:
                        async with session.get(p_url, timeout=aiohttp.ClientTimeout(total=3), ssl=False, allow_redirects=True) as gf_resp:
                            if gf_resp.status == 200:
                                out['join_url'] = str(gf_resp.url)
                                break
                    except:
                        pass
            elif out['net'] == 'BixGrow':
                p_url = f"https://{slug}.bixgrow.com/register"
                try:
                    async with session.get(p_url, timeout=aiohttp.ClientTimeout(total=3), ssl=False, allow_redirects=True) as bx_resp:
                        if bx_resp.status == 200:
                            out['join_url'] = str(bx_resp.url)
                except:
                    pass
            elif out['net'] == 'Shopify Collabs':
                p_url = f"https://join.collabs.shopify.com/community/apply/{slug}"
                try:
                    async with session.get(p_url, timeout=aiohttp.ClientTimeout(total=3), ssl=False, allow_redirects=True) as cl_resp:
                        if cl_resp.status == 200:
                            out['join_url'] = str(cl_resp.url)
                except:
                    pass
            elif out['net'] == 'Refersion':
                p_url = f"https://{slug}.refersion.com/affiliate/registration"
                try:
                    async with session.get(p_url, timeout=aiohttp.ClientTimeout(total=3), ssl=False, allow_redirects=True) as rf_resp:
                        if rf_resp.status == 200:
                            out['join_url'] = str(rf_resp.url)
                except:
                    pass

        # 5. STRICT VERIFICATION: Verify the candidate join_url actually loads a REAL affiliate registration page
        if out['join_url']:
            try:
                # Do not accept products or collections
                if any(bad in out['join_url'].lower() for bad in BAD_PATH_SEGMENTS):
                    out['join_url'] = None
                    return None

                async with session.get(out['join_url'], timeout=aiohttp.ClientTimeout(total=4), ssl=False, allow_redirects=True) as v_resp:
                    if v_resp.status < 400 and '/password' not in str(v_resp.url) and v_resp.status != 410:
                        v_html = await v_resp.text(errors='ignore')
                        # Check for strong affiliate program intent
                        if any(w in v_html.lower() for w in STRONG_CONTENT_INDICATORS) or '<form' in v_html.lower():
                            title_m = re.findall(r'<title>([^<]+)</title>', v_html, re.I)
                            out['form_title'] = title_m[0].strip()[:60] if title_m else 'Affiliate Registration'
                            out['join_url'] = str(v_resp.url)
                            out['is_live_project'] = True
            except:
                pass

    if out['is_live_project']:
        return out
    return None
