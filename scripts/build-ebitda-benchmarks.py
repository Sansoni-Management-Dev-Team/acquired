"""Refresh the checked-in ABS reference data. Downloads a workbook; never accesses a database."""
import io
import json
from pathlib import Path
import re
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

SOURCE = 'https://www.abs.gov.au/statistics/industry/industry-overview/australian-industry/2024-25/81550DO001_202425.xlsx'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
PERIODS = ['2022-23', '2023-24', '2024-25']
DIVISIONS = [
    (1, 5, 'Agriculture, forestry and fishing'), (6, 10, 'Mining'), (11, 25, 'Manufacturing'),
    (26, 29, 'Electricity, gas, water and waste services'), (30, 32, 'Construction'),
    (33, 38, 'Wholesale trade'), (39, 43, 'Retail trade'), (44, 45, 'Accommodation and food services'),
    (46, 53, 'Transport, postal and warehousing'), (54, 60, 'Information media and telecommunications'),
    (66, 67, 'Rental, hiring and real estate services'), (69, 70, 'Professional, scientific and technical services'),
    (72, 73, 'Administrative and support services'), (77, 77, 'Public administration and safety (private)'),
    (80, 82, 'Education and training (private)'), (84, 87, 'Health care and social assistance (private)'),
    (89, 92, 'Arts and recreation services'), (94, 95, 'Other services'),
]

def slug(value):
    return re.sub(r'[^a-z0-9]+', '-', value.lower()).strip('-')

def number(value):
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def main():
    archive = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(SOURCE, timeout=60).read()))
    strings = [''.join(item.itertext()) for item in ET.fromstring(archive.read('xl/sharedStrings.xml'))]

    def rows(sheet):
        for row in ET.fromstring(archive.read(f'xl/worksheets/sheet{sheet}.xml')).findall('.//m:row', NS):
            values = {}
            for cell in row:
                value = cell.find('m:v', NS)
                if value is not None:
                    values[re.sub(r'\d', '', cell.attrib['r'])] = strings[int(value.text)] if cell.get('t') == 's' else value.text
            yield int(row.attrib['r']), values

    def observation(values, row, period, employment_col, ebitda_col):
        employment, ebitda = number(values.get(employment_col)), number(values.get(ebitda_col))
        if employment is None or employment <= 0 or ebitda is None:
            return None
        return {'period': period, 'employmentThousands': employment, 'ebitdaMillions': ebitda,
                'cells': f'{employment_col}{row}, {ebitda_col}{row}'}

    records = {}
    label = ''
    for row, values in rows(2):
        value = values.get('A', '')
        if value and value not in PERIODS:
            label = value
        if value not in PERIODS:
            continue
        code = re.match(r'^(\d{2}) (.+)$', label)
        if code:
            industry = code[2]
            division = next((name for low, high, name in DIVISIONS if low <= int(code[1]) <= high), None)
            key = f'anzsic-{code[1]}'
            level = 'subdivision'
        else:
            division = next((name for _, _, name in DIVISIONS if label.lower() == f'Total {name}'.lower()), None)
            if label == 'Total selected industries':
                industry, key, level = 'All selected industries', 'all-industries', 'economy'
            elif division:
                industry, key, level = division, f'division-{slug(division)}', 'division'
            else:
                continue
        item = observation(values, row, value, 'B', 'H')
        if item:
            record = records.setdefault(key, {'id': key, 'label': industry, 'division': division,
                'level': level, 'sizeMin': None, 'sizeMax': None, 'sheet': 'Table_1', 'observations': []})
            record['observations'].append(item)

    band = None
    bands = {'0–4 EMPLOYEES': (0, 4), '5–19 EMPLOYEES': (5, 19),
             '20–199 EMPLOYEES': (20, 199), '200 OR MORE EMPLOYEES': (200, None)}
    for row, values in rows(6):
        industry = values.get('A', '')
        if industry == 'TOTAL':
            break
        if industry in bands:
            band = bands[industry]
            continue
        if band is None or industry not in [name for _, _, name in DIVISIONS]:
            continue
        observations = [observation(values, row, period, emp, ebitda)
            for period, emp, ebitda in zip(PERIODS, ['B', 'C', 'D'], ['W', 'X', 'Y'])]
        observations = [item for item in observations if item]
        if observations:
            key = f'size-{slug(industry)}-{band[0]}-{band[1] or "plus"}'
            size = f'{band[0]}–{band[1]}' if band[1] is not None else f'{band[0]}+'
            records[key] = {'id': key, 'label': f'{industry} — {size} employees', 'division': industry,
                'level': 'size', 'sizeMin': band[0], 'sizeMax': band[1], 'sheet': 'Table_5', 'observations': observations}

    # Do not silently substitute an older year for a suppressed latest observation.
    benchmarks = [r for r in records.values() if any(o['period'] == PERIODS[-1] for o in r['observations'])]
    assert sum(r['level'] == 'subdivision' for r in benchmarks) == 79
    assert sum(r['level'] == 'size' for r in benchmarks) == 72
    output = {'sourceUrl': SOURCE, 'releaseDate': '2026-06-19', 'latestPeriod': '2024-25',
        'methodologyUrl': 'https://www.abs.gov.au/methodologies/australian-industry-methodology/2024-25',
        'benchmarks': benchmarks}
    path = Path(__file__).resolve().parents[1] / 'src/domain/data/abs-ebitda-benchmarks.json'
    path.write_text(json.dumps(output, indent=2) + '\n')
    print(f'Wrote {len(benchmarks)} benchmarks to {path}')

if __name__ == '__main__':
    main()
