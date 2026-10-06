"""Fetch the public HQ previews of explicitly reviewed CC0 Freesound sources."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import json
import re
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / 'assets' / 'audio-source' / 'materials'
SOURCES = [
    ('ice', 'timbreknight', 342546, 'Ice cracking'),
    ('metal', 'kermite607', 362625, 'Metal Clang sound'),
    ('steel', 'dersinnsspace', 435223, 'Tube hit 08, high+ringing'),
    ('heavy-metal', 'ani_music', 244983, 'ANI Big Pipe Hit'),
    ('splash', 'bxyorna', 410335, 'Water drop / Splash'),
    ('wind', 'Fasolt', 113176, 'wind_howling_04.wav'),
    ('fire', 'jmehlferber', 370938, 'fire-crackling.wav'),
    ('waves', 'SKrafft', 681374, 'Waves Close-Up'),
]

def read(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read()

def fetch(source):
    key, author, sound_id, title = source
    page = f'https://freesound.org/people/{author}/sounds/{sound_id}/'
    manifest_path = DEST / 'sources.json'
    if manifest_path.exists() and (DEST / f'{key}.mp3').exists():
        cached = next((s for s in json.loads(manifest_path.read_text(encoding='utf-8')) if s['key'] == key), None)
        if cached and cached['source'] == page:
            return cached
    html = read(page).decode('utf-8')
    assert 'creativecommons.org/publicdomain/zero/1.0' in html, f'Unverified CC0: {page}'
    previews = re.findall(r'https://cdn\.freesound\.org/previews/[^\s\"<>]+-hq\.mp3', html)
    assert previews, f'No HQ preview on {page}'
    preview = previews[0]
    audio = read(preview)
    (DEST / f'{key}.mp3').write_bytes(audio)
    return {'key': key, 'title': title, 'author': author, 'source': page,
            'preview': preview, 'license': 'CC0-1.0',
            'licenseUrl': 'https://creativecommons.org/publicdomain/zero/1.0/',
            'downloadedFormat': 'Freesound HQ MP3 preview',
            'sha256': hashlib.sha256(audio).hexdigest(), 'bytes': len(audio)}

if __name__ == '__main__':
    DEST.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=6) as pool:
        manifest = list(pool.map(fetch, SOURCES))
    (DEST / 'sources.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(json.dumps([{'key': s['key'], 'bytes': s['bytes']} for s in manifest]))
