import os, json, hashlib

img_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'owner-menus', 'images', 'manu-dosa-place')
sources = json.load(open(os.path.join(img_dir, 'sources.json'), 'r', encoding='utf-8'))
print('Total entries in sources.json:', len(sources))

hashes = set()
for s in sources:
    fpath = os.path.join(img_dir, s['file'])
    assert os.path.exists(fpath), f"Missing file {s['file']}"
    data = open(fpath, 'rb').read()
    assert data[:2] == b'\xff\xd8', f"{s['file']} is not JPEG"
    assert b'Exif\x00\x00' not in data, f"{s['file']} has Exif"
    assert 20 * 1024 <= len(data) <= 450 * 1024, f"{s['file']} invalid size {len(data)}"
    h = hashlib.sha256(data).hexdigest()
    assert h not in hashes, f"Duplicate image hash for {s['file']}"
    hashes.add(h)

print(f"PASSED! All {len(hashes)} images are 100% verified, valid JPEGs, zero Exif, and ZERO duplicates!")

