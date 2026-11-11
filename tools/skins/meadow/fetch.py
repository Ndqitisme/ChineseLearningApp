"""Downloads the Poly Haven models the meadow border is rendered from, pinned by sha256.

    python tools/skins/meadow/fetch.py          # download what assets.lock.json lists into .cache/polyhaven/
    python tools/skins/meadow/fetch.py --lock   # rebuild assets.lock.json from the Poly Haven API (md5-checked)

Every Poly Haven asset is CC0 (https://polyhaven.com/license). A file whose sha256 differs from the lock is an
error: the render must come from exactly these inputs.
"""

import hashlib
import json
import os
import sys
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
LOCK = os.path.join(os.path.dirname(__file__), 'assets.lock.json')
CACHE = os.path.join(ROOT, '.cache', 'polyhaven')
# asset -> texture resolution; the sprites are small, so the larger plants need no more than 1k.
ASSETS = {'celandine_01': '2k', 'dandelion_01': '2k', 'flower_empodium': '2k', 'shrub_sorrel_01': '2k',
          'periwinkle_plant': '1k', 'shrub_01': '1k'}
AGENT = {'User-Agent': 'tieumai-asset-fetch'}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=AGENT), timeout=120) as r:
        return r.read()


def digest(data, algo):
    h = hashlib.new(algo)
    h.update(data)
    return h.hexdigest()


def build_lock():
    files = []
    for asset, res in ASSETS.items():
        info = json.loads(get(f'https://api.polyhaven.com/files/{asset}'))
        blend = info['blend'][res]['blend']
        entries = [(f'{asset}.blend', blend)] + list(blend.get('include', {}).items())
        for rel, e in entries:
            data = get(e['url'])
            if digest(data, 'md5') != e['md5'] or len(data) != e['size']:
                raise SystemExit(f'{asset}/{rel}: md5 or size differs from the Poly Haven API')
            files.append({'asset': asset, 'path': rel, 'url': e['url'], 'size': e['size'], 'sha256': digest(data, 'sha256')})
            save(asset, rel, data)
            print(f'locked {asset}/{rel} ({e["size"] // 1024} KB)')
    with open(LOCK, 'w', encoding='utf-8', newline='\n') as f:
        json.dump({'source': 'https://polyhaven.com (CC0)', 'files': files}, f, indent=1)
        f.write('\n')


def save(asset, rel, data):
    path = os.path.join(CACHE, asset, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(data)


def fetch():
    with open(LOCK, encoding='utf-8') as f:
        lock = json.load(f)
    for e in lock['files']:
        path = os.path.join(CACHE, e['asset'], e['path'])
        if os.path.exists(path):
            with open(path, 'rb') as f:
                if digest(f.read(), 'sha256') == e['sha256']:
                    continue
        data = get(e['url'])
        if digest(data, 'sha256') != e['sha256']:
            raise SystemExit(f'{e["asset"]}/{e["path"]}: sha256 differs from assets.lock.json')
        save(e['asset'], e['path'], data)
        print(f'fetched {e["asset"]}/{e["path"]} ({e["size"] // 1024} KB)')
    print(f'{len(lock["files"])} files ready in {CACHE}')


if __name__ == '__main__':
    build_lock() if '--lock' in sys.argv else fetch()
