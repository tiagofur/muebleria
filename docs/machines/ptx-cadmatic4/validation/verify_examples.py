#!/usr/bin/env python3
"""Offline checks for original documentation examples; NOT a production PTX validator.

No external libraries or network access. Does not import the Granete repository.
Writes verification_result.json next to this script.
"""
from __future__ import annotations
import csv
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)

def area(rect: dict) -> int:
    return rect['lengthMm'] * rect['widthMm']

def overlaps(a: dict, b: dict) -> bool:
    return (max(a['xMm'], b['xMm']) < min(a['xMm'] + a['lengthMm'], b['xMm'] + b['lengthMm'])
            and max(a['yMm'], b['yMm']) < min(a['yMm'] + a['widthMm'], b['yMm'] + b['widthMm']))

def main() -> None:
    trace = json.loads((ROOT / 'examples/01_expected_trace.json').read_text())
    all_regions = {r['regionId']: r for r in trace['regions']}
    available = {'BOARD'}
    for event in trace['events']:
        parent_id = event['parentRegionId']
        require(parent_id in available, f'Parent not available: {parent_id}')
        parent = all_regions[parent_id]
        children = [all_regions[key] for key in event['outputRegionIds']]
        band = event['kerfBand']
        outputs = children + [band]
        for rect in outputs:
            require(rect['lengthMm'] > 0 and rect['widthMm'] > 0, 'Invalid rectangle')
            require(rect['xMm'] >= parent['xMm'] and rect['yMm'] >= parent['yMm'], 'Outside parent')
            require(rect['xMm'] + rect['lengthMm'] <= parent['xMm'] + parent['lengthMm'], 'Outside X')
            require(rect['yMm'] + rect['widthMm'] <= parent['yMm'] + parent['widthMm'], 'Outside Y')
        require(sum(map(area, outputs)) == area(parent), 'Area not conserved')
        require(all(not overlaps(outputs[i], outputs[j]) for i in range(len(outputs))
                    for j in range(i + 1, len(outputs))), 'Overlapping output regions')
        available.remove(parent_id)
        available.update(event['outputRegionIds'])
    require(available == set(trace['expectedLeafRegionIds']), 'Unexpected final leaves')
    bands_area = sum(area(e['kerfBand']) for e in trace['events'])
    leaves_area = sum(area(all_regions[i]) for i in available)
    require(bands_area + leaves_area == area(all_regions['BOARD']), 'Global area mismatch')

    fragment = ROOT / 'examples/01_recorte_tres_fases.ptx.txt'
    with fragment.open(newline='') as handle:
        records = list(csv.reader(handle))
    require(len(records) == 4, 'Expected four didactic records')
    require(all(len(row) == 11 and row[0] == 'CUTS' for row in records), 'Fragment column mismatch')
    require([int(r[5]) for r in records] == [1, 2, 2, 3], 'Phase mismatch')
    require([float(r[6]) for r in records] == [320, 450, 280, 210], 'Dimension mismatch')
    require([r[8] for r in records] == ['0', '1', '0', '2'], 'Part reference mismatch')
    require(sum(int(r[9]) for r in records) == 2, 'Expected two produced parts in exercise')

    # Intentionally reduced reproduction of X/Y rules read in main@b3efd419.
    # It is NOT execution of the actual TypeScript helpers or optimizer.
    counter = json.loads((ROOT / 'validation/counterexample.json').read_text())
    pieces = counter['pieces']
    xs, ys = set(p['xMm'] for p in pieces), set(p['yMm'] for p in pieces)
    horizontal = len(pieces) / len(ys) >= len(pieces) / len(xs)
    require(not horizontal, 'Expected vertical choice by the reviewed preview heuristic')
    first_x = min(xs)
    preview_cut_x = max(p['xMm'] + p['lengthMm'] for p in pieces if p['xMm'] == first_x)
    first_y = min(ys)
    export_cut_y = first_y + max(p['widthMm'] for p in pieces if p['yMm'] == first_y)
    require(preview_cut_x == 400 and export_cut_y == 600, 'Counterexample changed')
    require(400 + 4 + 596 == 1000 and 196 + 4 + 196 + 4 + 200 == 600,
            'Counterexample is not geometrically valid')

    result = {
        'status': 'PASS_FOR_SCOPED_OFFLINE_CHECKS_ONLY',
        'limitations': ['No complete PTX validation', 'No Granete test suite execution',
                        'No CADLink conversion', 'No CADmatic import', 'No machine execution'],
        'checks': ['Parent availability', 'Positive dimensions', 'Child containment',
                   'No overlap', 'Per-split and global area conservation', 'Expected leaves',
                   'Four CUTS rows: field counts, phases, dimensions, refs and exercise quantities',
                   'Reduced X/Y rule counterexample'],
        'example': {'boardAreaMm2': area(all_regions['BOARD']), 'leafAreaMm2': leaves_area,
                    'kerfAreaMm2': bands_area, 'partsCount': 2},
        'counterexample': {'previewFirstCut': {'axis': 'x', 'coordinateMm': preview_cut_x},
                           'exportFirstRip': {'axis': 'y', 'coordinateMm': export_cut_y},
                           'sameCut': False},
        'fragmentSha256': hashlib.sha256(fragment.read_bytes()).hexdigest(),
    }
    out = ROOT / 'validation/verification_result.json'
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
