#!/usr/bin/env python3
"""Check report-only syntax and exact local asset references; not browser behavior."""
import json,re,subprocess,datetime
from pathlib import Path
root=Path(__file__).resolve().parents[1]
checks=[]
for relative in ['js/app.js','data/bundle.js']:
 result=subprocess.run(['node','--check',str(root/relative)],capture_output=True,text=True)
 checks.append({'check':'node --check '+relative,'exitCode':result.returncode,'output':result.stdout+result.stderr})
refs=re.findall(r'(?:src|href)="([^"]+)"',(root/'index.html').read_text())
refs=[r for r in refs if not re.match(r'^(?:https?:|#|mailto:)',r)]
local=[{'ref':r,'exists':(root/r.split('#')[0]).is_file()} for r in refs]
missing=[]
def walk(value,source):
 if isinstance(value,dict):
  for v in value.values():walk(v,source)
 elif isinstance(value,list):
  for v in value:walk(v,source)
 elif isinstance(value,str) and re.fullmatch(r'(?:evidence|assets|data)/[\w./ -]+(?:#[\w.-]+)?',value):
  if not (root/value.split('#')[0]).is_file():missing.append({'source':source,'ref':value})
for path in (root/'data').glob('*.json'):walk(json.loads(path.read_text()),path.name)
result={'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'syntax':checks,'htmlLocalReferences':local,'missingExactDataReferences':missing,'scope':'Exact local path strings only; prose-embedded refs, GitHub line contents, browser interactions and file:// are not certified.'}
(root/'evidence/portal-static-final.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False,indent=2))
raise SystemExit(any(r['exitCode'] for r in checks) or any(not r['exists'] for r in local) or bool(missing))
