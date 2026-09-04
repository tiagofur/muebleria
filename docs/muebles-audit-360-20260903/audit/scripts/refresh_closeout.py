#!/usr/bin/env python3
"""Refresh rolling report counts without deciding audit acceptance."""
import json,collections,datetime
from pathlib import Path
root=Path(__file__).resolve().parents[1]
def read(name):
 p=root/'data'/f'{name}.json'
 return json.loads(p.read_text()) if p.exists() else {}
fm=read('feature-matrix'); counts=collections.Counter(r.get('status','UNKNOWN') for r in fm.get('features',[])); fs=', '.join(f'{v} {k}' for k,v in sorted(counts.items()))
api=read('endpoint-supplement').get('coverage',{});base=read('backend-audit');runtime=sum('registration' in r for r in base.get('endpoints',[]));declarations=len(base.get('endpoints',[]))-runtime
web=read('web-semantic-audit'); db=read('database-deep-audit').get('counts',{})
summary={'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'auditBaseline':'316df57c7c3c9d5470b5a3f22b39fffeacfd7676','laterMain':'0eb53be61a5d7c4ea6d752264e6f37936fd054f1','laterMainScope':'Readback only; PR550 not audited','featureCounts':dict(counts),'featureRows':len(fm.get('features',[])),'featureReviewCoverage':fm.get('coverage',{}),'apiCoverage':api,'runtimeRegistrations':runtime,'additionalOpenapiDeclarations':declarations,'databaseCounts':db,'effectivePermissions':read('effective-permissions').get('coverage',{}),'webSupplementPresent':bool(web),'webCoverage':web.get('coverage',{}),'goalStatus':'ACTIVE — acceptance decision remains with root'}
(root/'evidence/rolling-closeout-counts.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
checkpoint=root/'CHECKPOINT.md';s=checkpoint.read_text();s=s.split('\n## Area progress')[0].split('\n## Rolling consolidation snapshot')[0];s+='\n## Rolling consolidation snapshot\n\n'
s+=f'Generated {summary["generatedAt"]}. Pinned audit remains316df57c; main later0eb53be6 mergedPR550/#394, NOT audited. Readback: evidence/main-readback-final.json.\n\n'
s+=f'- Features: {len(fm.get("features",[]))} rows; {fs}; zero COMPLETE. All-row fragment/scope review is not every acceptance item executed.\n'
s+=f'- API inventory: {runtime} runtime registrations + {declarations} additional OpenAPI declaration/alias rows; not265distinctruntimeendpoints. Supplement: {api.get("supplementRows","pending")} rows, combined handler-semantic review {api.get("combinedSemanticRows","pending")}, future-scope declarations {api.get("futureDeclarationsReviewed",0)}, remaining unreviewed disposition {api.get("remainingUnreviewedRows","pending")}. No new HTTP/DB probes in supplements.\n'
s+=f'- PostgreSQL: {db.get("tablesObserved")} public tables ({db.get("applicationAndControlTables")}application/control +schema_migrations), {db.get("columns")}columns, {db.get("constraints")}constraints, {db.get("indexes")}indexes. Historical76names preserved, two retired. Metadata SELECT-only, not business rows or production.\n'
s+='- Additional pure-domain proofs: template roundtrip3/3 reproduces6field loss; drilling context1/1 reproduces first-owner order dependence. No UI/API/DB/DXF/native/machine proof or product fix.\n'
wc=web.get('coverage',{})
s+=f'- Web: {wc.get("semanticScreenFragments")} primary screen fragments; {wc.get("testBodiesInspected")} test bodies inspected; {wc.get("componentFragmentFiles")} fragment files. Secondary259 / inline140 each classified by specific fragment, shared contract, reused pattern or literal. No remaining context-only gaps; no all-consumer/runtime certification. See web-semantic-audit.coverage for full breakdown.\n'
pc=read('effective-permissions').get('coverage',{})
s+=f'- Effective permissions: {pc.get("familyCompositions")} source families, {pc.get("supplementRowsLinked")} supplement rows linked; separate from536role predicates and all265mixed-row authority ledger. No exhaustive HTTP role-state proof.\n'
s+='- Documentation:371files, selected-claim semantic comparison by15families. Not every sentence/historical proof certified.\n'
s+='- Canonical new findings FM01–05, EPSF01 and AUTH-CONTRACT01 retained in their sources; synthesis references them without duplicate finding rows. QV01 kept distinct from immutable backend revisions.\n'
s+='- Latest portal mappings have static verification only. Prior HTTPdesktop/mobile/filter/search/expand QA retained; final rerun hit browser internal error after reportserverrestart. ServerHEAD200 is not UI proof. file:// blocked by tool policy; no workaround.\n'
s+='- This is a rolling checkpoint, not delivery certification. See evidence/audit-closeout-gaps.md and completion-coverage.json for exact remaining proofs.\n'
s=s.replace('clipboard success not yet confirmed','button feedback Copiado observed; clipboard bytes not inspected')
checkpoint.write_text(s)
gaps=root/'evidence/audit-closeout-gaps.md';s=gaps.read_text();s=s.split('\n## Rolling evidence update')[0];s+='\n## Rolling evidence update\n\n'
s+=f'The earlier numeric snapshots above are superseded by this section and evidence/rolling-closeout-counts.json: features{fs}; no candidate-only blanket is retained when semantic fragments exist. API{runtime}runtime+{declarations}declarations, combinedsemantic{api.get("combinedSemanticRows","pending")}, futuredeclarations{api.get("futureDeclarationsReviewed",0)}, unrevieweddisposition{api.get("remainingUnreviewedRows","pending")}.\n\n'
s+='Remaining real work concerns per-criterion acceptance, effective role/resource/relationship checks, per-screen unexecuted states and authoritative end-to-end continuity—not absence of all review. Native host, machine readback, representative load and final file:// runtime remain narrowly bounded UNKNOWN. New mainPR550 is outside this audit, not silently incorporated.\n'
s=s.replace('64 PARTIAL y 140 UNKNOWN',fs).replace('No usar el conteo anterior 192/12.','Conteo leído del JSON actual; no utilizar snapshots previos.')
s=s.replace('Validar cada criterio y mapear implementación/pruebas de las 140 filas UNKNOWN y todas las capas pendientes','Validar criterios individuales y pruebas de todas las capas pendientes; la revisión semántica de fragmentos ya cubre las204filas')
s=s.replace('Semántica de auth/roles/inputs/output/side effects/callers en las 244 rutas sin suplemento profundo',f'{api.get("combinedSemanticRows","pending")} registros con semántica acotada +{api.get("futureDeclarationsReviewed",0)}declaraciones futuras revisadas; quedan callers/DTOs/side effects/roles no probados, no filas ignoradas')
s=s.replace('El suplemento no debe extrapolarse a los 244 restantes.',f'Suplemento ahora {api.get("supplementRows","pending")}filas, combinado{api.get("combinedSemanticRows","pending")}semánticas; no confundirlo con ejecuciónHTTP.')
s=s.replace('inventario de 265 rutas','inventario mixto de241registrosruntime y24declaracionesOpenAPI')
s=s.replace('feature matrix.json','feature-matrix.json')
s=s.replace('La tabla actual es baseline estático, no seguridad efectiva exhaustiva','Hay41composiciones efectivas y244/244suplementarias vinculadas, además del ledger265mixto; sigue sin prueba HTTP exhaustiva')
s=s.replace('Alinear README/checkpoint/resumen y counts con las últimas fuentes; validar lista de15secciones finales contra pedido','Counts, ocho Top10, mappings, normalizador y referencias locales regenerados; el auditor principal valida su respuesta final contra las15secciones solicitadas')
gaps.write_text(s)
print(json.dumps({k:v for k,v in summary.items() if k not in ['featureReviewCoverage']},ensure_ascii=False,indent=2))
