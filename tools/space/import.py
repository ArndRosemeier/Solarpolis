"""Refresh the offline Solarpolis astronomy pack from JPL public services.

Run with Python + numpy + beautifulsoup4. curl uses the platform certificate store.
Horizons requests are sequential, cached in .render/astronomy; no runtime network dependency.
"""
from pathlib import Path
import datetime
import json
import math
import subprocess
import shutil
import urllib.parse
import numpy as np
from bs4 import BeautifulSoup
import re

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.render' / 'astronomy'
OUT = ROOT / 'public' / 'space'
CACHE.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)


def download(url, name):
    path = CACHE / name
    if not path.exists():
        subprocess.run([shutil.which('curl.exe') or 'curl', '--fail', '--location', '--silent', '--show-error', url, '--output', str(path)], check=True)
    return path.read_text(encoding='utf8')


def vectors(code, centre, start, stop, step, name):
    params = dict(COMMAND=code, CENTER=centre, EPHEM_TYPE='VECTORS', START_TIME=f'JD{start}', STOP_TIME=f'JD{stop}',
                  STEP_SIZE=f'{round(step * 1440)} m', OUT_UNITS='KM-S', REF_PLANE='ECLIPTIC', REF_SYSTEM='ICRF',
                  VEC_TABLE='2', CSV_FORMAT='YES', VEC_CORR='NONE', TIME_TYPE='TDB')
    url = 'https://ssd.jpl.nasa.gov/api/horizons.api?' + urllib.parse.urlencode({'format': 'json', **{k: f"'{v}'" for k, v in params.items()}})
    data = json.loads(download(url, name + '.json'))
    result = data.get('result', '')
    if '$$SOE' not in result:
        raise ValueError(data.get('error', result))
    rows = [line.split(',') for line in result.split('$$SOE')[1].split('$$EOE')[0].strip().splitlines()]
    return np.array([[float(r[0]), *map(float, r[2:8])] for r in rows])


def ephemeris():
    # A sixty-year travel background centred on the setting, all within DE441's range.
    start = 2451544.5 + (datetime.date(3020, 1, 1) - datetime.date(2000, 1, 1)).days
    stop = start + (datetime.date(3080, 1, 1) - datetime.date(3020, 1, 1)).days
    bodies = [('mercury', '1', 16), ('venus', '2', 64), ('emb', '3', 32), ('mars', '4', 64),
              ('jupiter', '5', 128), ('saturn', '6', 128), ('uranus', '7', 128), ('neptune', '8', 128), ('pluto', '9', 128), ('moon', '301', 8)]
    pack = {'source': 'JPL Horizons / DE441; geometric J2000 ecliptic, TDB; km', 'start': start, 'stop': stop, 'degree': 12, 'bodies': {}}
    checks = []
    for name, code, span in bodies:
        count = math.ceil((stop - start) / span)
        rows = vectors(code, '500@399' if name == 'moon' else '500@10', start, start + count * span, span / 32, f'{name}-{span}')
        coefficients = []
        worst = 0
        for i in range(count):
            sample = rows[i * 32:i * 32 + 33]
            if len(sample) != 33:
                raise ValueError(f'{name}: incomplete segment {i}')
            x = np.linspace(-1, 1, 33)
            coeff = np.polynomial.chebyshev.chebfit(x[::2], sample[::2, 1:4], 12)
            fitted = np.polynomial.chebyshev.chebval(x[1::2], coeff).T
            worst = max(worst, float(np.linalg.norm(fitted - sample[1::2, 1:4], axis=1).max()))
            coefficients.extend(float(f'{v:.14g}') for v in coeff.T.flatten())
            if i in [0, count // 2, count - 2]:
                checks.append({'body': name, 'jd': float(sample[15, 0]), 'km': sample[15, 1:4].tolist()})
        pack['bodies'][name] = {'span': span, 'maxErrorKm': worst, 'coefficients': coefficients}
        print(f'{name}: {count} segments, withheld-sample error {worst:.6f} km', flush=True)
    (OUT / 'ephemeris.json').write_text(json.dumps(pack, separators=(',', ':')), encoding='utf8')
    (ROOT / 'test' / 'fixtures').mkdir(exist_ok=True)
    (ROOT / 'test' / 'fixtures' / 'solar-vectors.json').write_text(json.dumps(checks, indent=2), encoding='utf8')


def satellites():
    soup = BeautifulSoup(download('https://ssd.jpl.nasa.gov/sats/elem/sep.html', 'satellite-elements.html'), 'html.parser')
    physical = BeautifulSoup(download('https://ssd.jpl.nasa.gov/sats/phys_par/', 'satellite-physical.html'), 'html.parser')
    radii = {}
    for tr in physical.select('table')[0].select('tr')[2:]:
        cells = [c.get_text(' ', strip=True) for c in tr.select('td')]
        if len(cells) >= 9 and cells[2].isdigit():
            radii[cells[2]] = float(cells[6].split()[0])
    planets = ['earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto']
    records = []
    for table in soup.select('table')[:-1]:
        meta = table.find_previous('p').get_text(' ', strip=True)
        date = re.search(r'Epoch: (\d+)-(\d+)-(\d+(?:\.\d+)?)', meta)
        y, m, d = int(date[1]), int(date[2]), float(date[3])
        epoch = 2451544.5 + (datetime.date(y, m, int(d)) - datetime.date(2000, 1, 1)).days + d % 1
        parent = next(p for p in planets if p in table.find_previous('h3').get_text().lower())
        frame = 'laplace' if 'Laplace' in meta else 'ecliptic' if 'ecliptic' in meta else 'equatorial'
        for tr in table.select('tr')[1:]:
            c = [td.get_text(' ', strip=True) for td in tr.select('td')]
            if len(c) < 12:
                continue
            number = lambda k: 0 if c[k] in ['-', 'n/a'] else float(c[k])
            records.append(dict(id='moon-' + c[1], name=c[0], code=c[1], parent=parent, epoch=epoch, frame=frame,
                a=number(2), e=number(3), peri=number(4), anomaly=number(5), inclination=number(6), node=number(7),
                period=number(8), apsisPeriod=number(9), nodePeriod=number(10),
                pole=[number(11), number(12)] if frame == 'laplace' else None,
                radius=radii.get(c[1], 1), radiusKnown=c[1] in radii))
    # Puck appears in two fitted tables; prefer the later catalogue entry/epoch, never duplicate a moon.
    records = list({r['id']: r for r in records}.values())
    for r in records:
        if r['radiusKnown'] or (r['name'].startswith('S') and r['name'] != 'S2025_U_1'):
            continue
        url = 'https://ssd.jpl.nasa.gov/api/horizons.api?' + urllib.parse.urlencode({'format': 'json', 'COMMAND': r['code'], 'MAKE_EPHEM': 'NO'})
        text = json.loads(download(url, f'body-{r["code"]}.json')).get('result', '')
        # Some provisional five-digit satellite IDs collide with asteroid search numbers in Horizons.
        if f'({r["parent"].title()})' not in text:
            continue
        found = re.search(r'(?:Mean\s+radius|Radius)\s*\(km\)\s*=\s*([\d.]+)', text, re.I)
        axes = re.search(r'Radii\s*\([^)]*\):\s*([\d.]+)\s*x\s*([\d.]+)\s*x\s*([\d.]+)', text, re.I)
        magnitude = re.search(r'V\(1,0\)\s*=\s*\+?([\d.]+)', text)
        if found:
            r['radius'] = float(found[1])
            r['radiusKnown'] = True
        elif axes:
            r['radius'] = math.prod(float(v) for v in axes.groups()) ** (1 / 3)
            r['radiusKnown'] = True
        elif magnitude:
            r['radius'] = 1329 / math.sqrt(.04) * 10 ** (-float(magnitude[1]) / 5) / 2
        print(f'{r["name"]}: radius {r["radius"]} km' + ('' if found else ' (placeholder)'), flush=True)
    for r in records:
        r['name'] = {'Magaclite': 'Megaclite', 'Philophrosyn': 'Philophrosyne'}.get(r['name'], r['name'])
        if r['name'] == 'S2025_U_1':
            r['radius'] = 5  # NASA/Webb discovery announcement, 2025-08-19; photometric estimate.
    # Ring-embedded moonlet omitted from the fitted-elements table; IAUC 9091's measured radius/distance.
    # Its phase is unknown. A circular ring-plane orbit derives the period from Saturn's GM.
    records.append(dict(id='moon-s2009s1', name='S2009_S_1', code='s2009s1', parent='saturn', epoch=2451545,
        frame='equatorial', pole=None, a=117000, e=0, peri=0, anomaly=0, inclination=0, node=0,
        period=2 * math.pi * math.sqrt(117000 ** 3 / 37931206.23) / 86400,
        apsisPeriod=0, nodePeriod=0, radius=.15, radiusKnown=False))
    (OUT / 'moons.json').write_text(json.dumps(records, separators=(',', ':')), encoding='utf8')
    print(f'{len(records)} satellites, {sum(r["radiusKnown"] for r in records)} measured radii', flush=True)


def small_bodies():
    result = []
    for name, number in [('ceres', 1), ('pallas', 2), ('vesta', 4), ('hygiea', 10), ('haumea', 136108), ('makemake', 136472), ('eris', 136199)]:
        raw = json.loads(download(f'https://ssd-api.jpl.nasa.gov/sbdb.api?sstr={number}&full-prec=true&phys-par=true', f'sbdb-{name}.json'))
        elems = {v['name']: float(v['value']) for v in raw['orbit']['elements']}
        result.append({'id': name, 'epoch': float(raw['orbit']['epoch']), **elems})
    (OUT / 'small-bodies.json').write_text(json.dumps(result, separators=(',', ':')), encoding='utf8')


if __name__ == '__main__':
    ephemeris()
    satellites()
    small_bodies()
