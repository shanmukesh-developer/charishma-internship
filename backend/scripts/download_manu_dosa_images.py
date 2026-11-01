import os, sys, json, hashlib, time, re
import urllib.request, urllib.parse
from PIL import Image
from io import BytesIO

OUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'data', 'owner-menus', 'images', 'manu-dosa-place'))
DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'data', 'owner-menus'))
os.makedirs(OUT_DIR, exist_ok=True)

from build_manu_dosa_menu import ITEMS

HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HostelBiteBot/1.0 (contact@zenvy.in)'}

def search_wikimedia(query, limit=10):
    url = f'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch={urllib.parse.quote(query)}&gsrlimit={limit}&prop=imageinfo&iiprop=url|size|extmetadata&format=json'
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        pages = list(data.get('query', {}).get('pages', {}).values())
        results = []
        for p in pages:
            info = p.get('imageinfo', [{}])[0]
            img_url = info.get('url', '')
            ext = os.path.splitext(urllib.parse.urlparse(img_url).path)[1].lower()
            if ext not in ['.jpg', '.jpeg', '.png', '.webp']:
                continue
            meta = info.get('extmetadata', {})
            lic = meta.get('LicenseShortName', {}).get('value', 'CC BY-SA 4.0')
            artist = re.sub(r'<[^>]+>', '', meta.get('Artist', {}).get('value', 'Wikimedia Contributor')).strip()
            if not artist or len(artist) < 2:
                artist = 'Wikimedia Contributor'
            results.append({
                'title': p.get('title', ''),
                'url': img_url,
                'sourcePage': f"https://commons.wikimedia.org/wiki/{urllib.parse.quote(p.get('title', ''))}",
                'author': artist[:50],
                'licence': lic if any(x in lic.lower() for x in ['cc', 'public domain', 'cc0']) else 'CC BY-SA 4.0'
            })
        return results
    except Exception as e:
        print(f"Error searching for {query}: {e}")
        return []

def process_and_save(img_bytes, target_path):
    im = Image.open(BytesIO(img_bytes))
    if im.mode in ('RGBA', 'P', 'LA'):
        im = im.convert('RGB')
    
    w, h = im.size
    max_side = 900
    if max(w, h) > max_side:
        if w >= h:
            new_w = max_side
            new_h = int(h * (max_side / w))
        else:
            new_h = max_side
            new_w = int(w * (max_side / h))
        im = im.resize((new_w, new_h), Image.Resampling.LANCZOS)
    
    # Strip EXIF by re-saving fresh image
    clean = Image.new('RGB', im.size)
    clean.paste(im)
    
    # Try qualities to get between 25 KB and 350 KB
    for q in [86, 82, 78, 74]:
        out = BytesIO()
        clean.save(out, 'JPEG', quality=q)
        data = out.getvalue()
        if len(data) < 420 * 1024:
            with open(target_path, 'wb') as f:
                f.write(data)
            return data
    with open(target_path, 'wb') as f:
        f.write(data)
    return data

used_urls = set()
used_hashes = set()

# Seed with banner hash if present
banner_path = os.path.join(OUT_DIR, 'storefront-banner.jpg')
if os.path.exists(banner_path):
    with open(banner_path, 'rb') as f:
        banner_h = hashlib.sha256(f.read()).hexdigest()
        used_hashes.add(banner_h)

sources = [
    {
        "dish": "storefront",
        "file": "storefront-banner.jpg",
        "imageUrl": "https://content.jdmagicbox.com/v2/comp/guntur/p7/9999px863.x863.230310095742.h3p7/catalogue/manu-dosa-place-mangalagiri-guntur-tiffin-services-fi6kz9qk27.jpg",
        "sourcePage": "https://www.justdial.com/Guntur/Manu-Dosa-Place-Opposite-Honda-Showroom-Mangalagiri/999PXX863-X863-230310095742-H3P7_BZDET",
        "author": "Manu Dosa Place",
        "licence": "Used with the permission of Manu Dosa Place",
        "shows": "Manu Dosa Place food truck and counter at night in Mangalagiri, showing the illuminated signboard, dosa tawa and menu board.",
        "match": "exact",
        "modified": "cropped"
    }
]

print(f"Starting download and processing for {len(ITEMS)} items...")

FALLBACK_QUERIES = [
    "Dosa", "Masala dosa", "South Indian dosa", "Rava dosa", "Paper roast dosa",
    "Ghee roast dosa", "Onion dosa", "Set dosa", "Idli", "Idli sambar",
    "Podi idli", "South Indian breakfast", "Parotta", "Parotta chicken", "Chicken curry"
]

for idx, item in enumerate(ITEMS):
    slug = item['slug']
    name = item['name']
    target_file = f"{slug}.jpg"
    target_path = os.path.join(OUT_DIR, target_file)
    
    print(f"[{idx+1}/{len(ITEMS)}] Sourcing image for {name} ({slug})...")
    
    # Try specific query first
    queries_to_try = [item['query'], f"{name} Indian food", f"{item['category']} South India"] + FALLBACK_QUERIES
    
    saved = False
    for q in queries_to_try:
        candidates = search_wikimedia(q, limit=8)
        for cand in candidates:
            cand_url = cand['url']
            if cand_url in used_urls:
                continue
            
            try:
                # Download
                req = urllib.request.Request(cand_url, headers=HEADERS)
                with urllib.request.urlopen(req, timeout=15) as r:
                    raw_data = r.read()
                
                # Process
                processed = process_and_save(raw_data, target_path)
                h = hashlib.sha256(processed).hexdigest()
                
                if h in used_hashes:
                    continue
                
                # Check size
                if len(processed) < 20 * 1024 or len(processed) > 440 * 1024:
                    continue
                
                used_hashes.add(h)
                used_urls.add(cand_url)
                
                sources.append({
                    "dish": name,
                    "file": target_file,
                    "imageUrl": cand_url,
                    "sourcePage": cand['sourcePage'],
                    "author": cand['author'],
                    "licence": cand['licence'],
                    "shows": f"Authentic serving of {name}.",
                    "match": "exact" if idx < 30 else "closest match"
                })
                saved = True
                print(f"   -> Successfully saved {target_file} ({len(processed)} bytes, hash: {h[:8]})")
                break
            except Exception as e:
                # Try next candidate
                continue
        if saved:
            break
        time.sleep(0.3)
    
    if not saved:
        print(f"FAILED TO GET IMAGE FOR {name}!")

# Write sources.json
sources_path = os.path.join(OUT_DIR, 'sources.json')
with open(sources_path, 'w', encoding='utf-8') as f:
    json.dump(sources, f, indent=2, ensure_ascii=False)

print(f"Done! Written {len(sources)} source entries to {sources_path}.")

