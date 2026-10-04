#!/usr/bin/env python3
"""Build the offline report payload. Never reads or changes product files."""
import json
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sources = {p.stem: json.loads(p.read_text()) for p in sorted((root / 'data').glob('*.json'))}
evidence = [str(p.relative_to(root)) for p in sorted((root / 'evidence').rglob('*')) if p.is_file()]
payload = {'sources': sources, 'evidenceFiles': evidence}
(root / 'data/bundle.js').write_text('window.AUDIT_DATA = ' + json.dumps(payload, ensure_ascii=False).replace('</', '<\\/') + ';\n')
print(f'Bundled {len(sources)} data sources and {len(evidence)} evidence files.')
