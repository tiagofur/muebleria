import json,collections
from pathlib import Path
r=Path(__file__).resolve().parents[1];s=r.parent/'source';p=r/'data/web-semantic-audit.json';d=json.loads(p.read_text());reviews={}
for file in r.glob('data/web-secondary-*.json'):
 x=json.loads(file.read_text());rows=x.get('features',x.get('reviews',x.get('fragments',[])))
 for row in rows:
  path=row.get('file',row.get('path'));assert path,(file,row.keys())
  for e in row.get('evidence',[]):
   ep=e.get('file',e.get('path',path));a=e.get('startLine',e.get('line'));b=e.get('endLine',a+len(e['excerpt'].splitlines())-1);actual='\n'.join((s/ep).read_text().splitlines()[a-1:b]);assert actual.rstrip()==e['excerpt'].rstrip(),(file,ep,a)
  reviews[path]={'artifact':str(file.relative_to(r)),**row}
for key,prefix in [('secondarySurfaceMappings','secondary'),('inlineSurfaceMappings','inline')]:
 for x in d[key]:
  if x['file'] in reviews:x.update(auditDepth='SEMANTIC_COMPONENT_FRAGMENT',componentReview=reviews[x['file']]);x['preciseMissingProof']=reviews[x['file']].get('missingProof','Specific caller, persistence, denial and runtime interaction remain unverified.')
  if x.get('surfaceKind')=='NONINTERACTIVE_LITERAL_EXPORT':x['auditDepth']='NONINTERACTIVE_LITERAL_CLASSIFIED';x['scope']='Literal declaration inspected; not an interactive UI surface. Consumer rendering remains separately bounded.'
 d['coverage'][prefix+'AuditDepthCounts']=dict(collections.Counter(x['auditDepth'] for x in d[key]));d['coverage'][prefix+'OnlyPendingNoSemanticContext']=sum(x['auditDepth']=='PENDING_EXACT_SURFACE_REVIEW' for x in d[key])
d['coverage']['componentFragmentFiles']=len(reviews);d['componentReviewSources']=sorted({x['artifact'] for x in reviews.values()});d['coverage']['secondaryDirectScreenCallerLinks']=sum(bool(x['screenContextIds']) for x in d['secondarySurfaceMappings'])
p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n');print(d['coverage'])
# Keep a readable current summary separate from historical reading checkpoints.
lines=['# Current Web supplemental coverage','',json.dumps(d['coverage'],ensure_ascii=False,indent=2),'','No full consumer/runtime certification. Direct source fragments, reused contracts, caller pointers and pending specific interactions are separate.','']
for group in ['secondarySurfaceMappings','inlineSurfaceMappings']:
 lines += ['## '+group,'']
 for x in d[group]:lines += [f"- **{x['id']}** — {x['auditDepth']}: `{x['file']}`. "+(x.get('componentReview',{}).get('claim') or x.get('componentReview',{}).get('actualBehavior') or x['boundary'])]
(r/'evidence/web-secondary-coverage.md').write_text('\n'.join(lines)+'\n')
# Update proven findings without broadening proof boundary.
f=r/'data/feature-matrix.json';fm=json.loads(f.read_text());x=next(x for x in fm['findings'] if x['id']=='FM-03');x.update(status='CONFIRMED_PURE_DOMAIN_REPRODUCTION',runtimeStatus='CONFIRMED_PURE_DOMAIN_REPRODUCTION',confidence='High for first-owner reuse across customDims variants: independent versus combined order-dependent drilling reproduced. Missing preset/options cache-key dimensions are not independently isolated.',impact='Pure-domain reproduction: larger door has 3 hinge cups alone, 2 when following smaller module, and 3 when order reverses; larger floor gains 6 issues. No UI, export file, machine or physical damage proof.',runtimeProofMissing='UI/export-file integration and exact machine/software readback remain unverified; preset/options dimensions require independent isolation.');x['runtimeEvidence']=['data/drilling-context-proof.json','evidence/drilling-context-proof.log'];fm['features'][127]['runtimeEvidence']=[{'artifact':'data/drilling-context-proof.json','scope':'Pure-domain first-owner/order dependence only'}];f.write_text(json.dumps(fm,ensure_ascii=False,indent=2)+'\n')
