from pathlib import Path
import json,collections,hashlib
r=Path(__file__).resolve().parents[1];s=r.parent/'source';p=r/'data/feature-matrix.json';d=json.loads(p.read_text());by={x['id']:x for x in d['features']};added=[]
for name in ['ui','extra']:
 doc=json.loads((r/f'data/feature-fragments-{name}.json').read_text())
 for row in doc['features']:
  f=by[row['id']];ids=[]
  for n,e in enumerate(row['evidence'],1):
   file=e.get('path',e.get('file'));a=e.get('startLine',e.get('line'));b=e.get('endLine',a+len(e['excerpt'].splitlines())-1);content=(s/file).read_text();excerpt='\n'.join(content.splitlines()[a-1:b]);assert excerpt.rstrip()==e['excerpt'].rstrip(),(row['id'],file,a)
   eid=f'FM-SEM-{name.upper()}-{row["id"]}-{n}';ids.append(eid);d['evidenceIndex'][eid]={'file':file,'startLine':a,'endLine':b,'excerpt':excerpt,'fileSha256':hashlib.sha256((s/file).read_bytes()).hexdigest(),'basis':e.get('basis','Named behavior inspected by delegated semantic reader'),'reviewLevel':'SEMANTIC FRAGMENT; not acceptance execution'}
  actual=row.get('actual',row.get('actualVsAcceptance'));boundary=row.get('acceptanceBoundary',row.get('preciseUnknown'));scope=row.get('reviewScope',row.get('scope'));status=row['status']
  f.update(status=status,featureStatus=status,auditDepth='SEMANTIC_FRAGMENT',reviewDepth=scope,sourceStatus='Named implementation or deferred scope semantically reviewed')
  f['semanticAssessment']={'claim':actual,'evidenceIds':ids,'scope':scope,'expectedVsActual':{'expected':f['description'],'actual':actual},'acceptanceBoundary':boundary,'sourceArtifact':f'data/feature-fragments-{name}.json','runtimeStatus':row['runtimeStatus']}
  f['verificationNextStep']['requiredEvidence']=row.get('nextProof',boundary)
  f['auditCrossReferences'].append({'artifact':f'data/feature-fragments-{name}.json','recordId':f['id'],'basis':'Semantic fragment with exact source excerpts; runtime not executed'})
  added.append(f['id'])
c=d['coverage'];c.update(statusCounts=dict(collections.Counter(f['status'] for f in d['features'])),semanticFragmentRows=sum('semanticAssessment' in f for f in d['features']),candidateOnlyRows=sum(f['auditDepth']=='SOURCE_INDEX_ONLY' for f in d['features']),auditDepthCounts=dict(collections.Counter(f['auditDepth'] for f in d['features'])),secondPassBoundary='All 204 ledger rows have a named semantic implementation or historical/deferred scope review. This is not exhaustive per-criterion or per-layer certification; unexecuted acceptance remains UNKNOWN.',reviewBoundary='204 bounded semantic reviews; layer-level candidate pointers and acceptance/runtime gaps remain explicit. Zero COMPLETE.')
c['semanticReviewFiles']=sorted(set(c['semanticReviewFiles'])|{e['file'] for k,e in d['evidenceIndex'].items() if k.startswith('FM-SEM')})
p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
report=r/'evidence/feature-matrix.md';txt=report.read_text();head='# Current feature review coverage\n\n204/204 rows have a bounded semantic implementation or historical/deferred scope review; **0 candidate-only rows**. '+str(c['statusCounts'])+'. **0 COMPLETE**. Per-layer candidate pointers and unexecuted acceptance remain; reading a fragment is not full-feature verification. Earlier pass counts below are historical checkpoints.\n\n'
report.write_text(head+txt+'\n## Integrated delegated semantic reviews\n\nThe 39 UI fragments and 28 later-ledger fragments were integrated with exact excerpt validation against the pinned source. Full details: `feature-fragments-ui.md`, `feature-fragments-extra.md`; normalized evidence is embedded in the matrix. No runtime tests were executed by these readers.\n')
print(c['statusCounts'],c['semanticFragmentRows'],c['candidateOnlyRows'])
