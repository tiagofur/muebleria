from pathlib import Path
import json,re,collections,hashlib
r=Path(__file__).resolve().parents[1];s=r.parent/'source';p=r/'data/web-semantic-audit.json';d=json.loads(p.read_text());inv=json.loads((r/'data/web-inventory.json').read_text());fm=json.loads((r/'data/feature-matrix.json').read_text())
manual=[
('Modal','common/Modal.tsx',55,235,'Portal to body; delayed unmount, body scroll lock, initial/return focus, Tab wrapping and Escape/backdrop close. Child onClose owns dirty/busy policy. Nested modal stacking and ancestor-hidden focusables need runtime proof.'),
('ConfirmDialog','common/ConfirmDialog.tsx',26,65,'Invokes onConfirm then onClose synchronously. It does not await an async mutation or own pending/error state; caller must supply that behavior or use a different contract.'),
('FullscreenDialog','common/FullscreenDialog.tsx',53,159,'Body portal with initial/restore focus, tab wrapping and optional Escape listener. Caller renders its own chrome; escapeEnabled allows explicit overlay coordination, not automatic stack ownership.'),
('DropdownMenu','common/DropdownMenu.tsx',76,270,'Enabled entries receive roving highlight; keyboard/click invokes onSelect, closes and restores trigger focus. Menu stays in local DOM (not portal), so clipping depends on consumer ancestors; async command success is not managed here.'),
('CatalogTable','catalogs/CatalogTable.tsx',31,181,'Presents passed rows; optional detail expansion only when callback and renderer exist. Enter/Space on row avoids nested controls; action wrapper stops propagation. Empty text is not network-error handling or authorization.'),
('WorkspaceTabs','common/Tabs.tsx',31,100,'Workspace/workflow variants share linked tab IDs, selected state and enabled-only roving hook. Hook wraps Arrow keys and supports Home/End. Caller must render matching panels and own activation side effects.'),
('WorkflowTabs','common/Tabs.tsx',31,100,'Same shared tab contract as WorkspaceTabs; semantic workflow ordering does not authorize a transition.'),
('EntityEditorLayout','common/EntityEditorLayout.tsx',100,214,'Selects inline editor, selected detail or list; renders caller form slots, routes Back through closeModal and discard through forceCloseEditor. Dirty computation and mutation success are owned by state hook/caller, not layout.'),
('ScreenBoundary','common/ScreenBoundary.tsx',23,67,'Render-error fallback displays alert, error detail, retry and optional home. This wrapper does not catch rejected event-handler promises or replace query error state.'),
('ProjectConfirmDeleteModal','projects/components/ProjectConfirmDeleteModal.tsx',8,43,'Displays exact project name and irreversible-delete warning; confirmation directly delegates to caller without local async state.'),
('ProjectConfirmReopenModal','projects/components/ProjectConfirmReopenModal.tsx',8,48,'Warns reopening clears frozen pricing and recalculates catalog; delegates command, so current server/history semantics must be compared separately.'),
('ProjectSaveAsTemplateModal','projects/components/ProjectSaveAsTemplateModal.tsx',8,66,'Resets template name on open; required input submits name callback. Copy promises layout preservation; FM-01 demonstrates missing modern layout in domain conversion, not tested UI persistence.'),
('HardwareFormModal','catalogs/hardware/HardwareFormModal.tsx',28,126,'Receives draft/error/submit externally and resets 3D disclosure per open. Footer submit targets exact formId. This fragment covers form ownership/reset, not all machining fields or save authorization.'),
('StockMovementModal','purchasing/StockMovementModal.tsx',49,140,'Validates selected material, signed nonzero adjustment or positive movement, and required adjustment note; awaits onSubmit before closing, retains error and resets saving on failure. Backdrop/cancel still delegate directly.'),
('StudioDeleteDialog','projects/components/StudioDeleteDialog.tsx',38,159,'Resets scope per selected placement; distinguishes plan removal versus entire quote line, disables unavailable project removal and lists other-space consequences. Caller owns actual deletion/undo/server command.')]
manual += [
('ChangeOrderModal','projects/components/ChangeOrderModal.tsx',38,99,'Create requires reason, parses impact values and awaits callback before clearing draft/list navigation. Busy resets in finally; this local handler has no catch/error state, so error feedback depends on the caller. Custom modal markup is not the reviewed Modal primitive.'),
('ProductionReleaseModal','projects/components/ProductionReleaseModal.tsx',33,83,'Release derives current/revoked state and gates from domain; requires allowed result or revoke reason, awaits callback before close and resets busy. This legacy project-release UI is not proof of exact DesignRevision release or server gate enforcement.'),
('QualityPanel','production/QualityPanel.tsx',67,134,'Quality view separates pending physical module-QC units. Issue report form requires canManage plus handler, trims description and clears it immediately after optional callback; persisted failure feedback requires caller review.'),
('PurchaseOrdersPanel','purchasing/PurchaseOrdersPanel.tsx',190,261,'PO submission filters valid material/positive quantity lines, requires supplier, and closes only after awaited save inside run. Receiving validates against remaining quantities and sends positive lines before close; server atomic stock posting remains separate.'),
('SiteSurveyPanel','projects/components/SiteSurveyPanel.tsx',65,132,'Capture requires positive finite width/height; optional positive depth and note are sent through handlers. Draft/capture closes immediately without awaiting callback. Empty state only offers start when canCapture and handler exist; freeze/approval server gates remain separate.'),
('WarrantyTicketsPanel','projects/components/WarrantyTicketsPanel.tsx',144,180,'Ticket creation awaits callback before closing. Resolve sends client timestamp and a default positive resolution note when blank, then clears local state; handler has finally but no local catch. Authoritative actor/time, notes and error display need server/caller proof.'),
('HardwarePlacementsEditor','modules/components/HardwarePlacementsEditor.tsx',34,81,'Manual placement editor updates by draft array index and emits onChange; remove emits undefined when empty, add defaults first hardware/front/50mm. Rotation merges selected axis. This draft form is distinct from broken viewport gizmo; persistent occurrence identity is not established here.'),
('AdminTransferModal','users/TeamLifecyclePanels.tsx',39,100,'Transfer shows no-eligible-member and reloadable error states, requires target/reason and disables confirm while busy. It sends exact membership ID via callbacks; transaction and step-up cancellation are owned by UsersScreen and linked WEB-02.')
]
def ev(file,a,b):
 ls=(s/file).read_text().splitlines();assert b<=len(ls),(file,b,len(ls));return {'file':file,'startLine':a,'endLine':b,'excerpt':'\n'.join(ls[a-1:b]),'sha256':hashlib.sha256((s/file).read_bytes()).hexdigest()}
families=[]
for name,file,a,b,claim in manual:
 file='packages/ui/src/'+file;families.append({'id':'WEB-PATTERN-'+name,'component':name,'file':file,'auditDepth':'SHARED_CONTRACT_SEMANTIC_REVIEW','claim':claim,'evidence':[ev(file,a,b)],'runtimeStatus':'UNKNOWN_NOT_EXECUTED','scope':'Only the shared primitive/explicit child contract described; consumer use does not inherit complete acceptance.'})
families[5]['evidence'].append(ev('packages/ui/src/common/rovingTabList.ts',25,74))
source_files=list((s/'packages/ui/src').rglob('*.tsx'))+list((s/'apps/web/src').rglob('*.tsx'));texts={str(f.relative_to(s)):f.read_text() for f in source_files}
feature_by_file=collections.defaultdict(list)
for f in fm['features']:
 for id in f.get('semanticAssessment',{}).get('evidenceIds',[]):
  e=fm['evidenceIndex'][id];feature_by_file[e['file']].append({'featureId':f['id'],'evidenceId':id,'claim':f['semanticAssessment']['claim'],'scope':f['semanticAssessment']['scope']})
manual_by_file=collections.defaultdict(list)
for f in families:manual_by_file[f['file']].append(f['id'])
# Context graph records JSX use sites only. It does not infer authorization or certify consumer behavior.
name_by_file={x['file']:x['id'] for x in inv['screens']};usage=collections.defaultdict(list)
for x in inv['secondaryInterfaces']:
 name=x['id'][4:];pat=re.compile(r'<'+re.escape(name)+r'(?=[\s/>])')
 for file,txt in texts.items():
  for m in list(pat.finditer(txt))[:2]:
   a=txt[:m.start()].count('\n')+1;usage[x['id']].append({'file':file,'line':a,'screenId':name_by_file.get(file),'basis':'Exact JSX use-site; caller behavior not certified','excerpt':'\n'.join(txt.splitlines()[max(0,a-2):a+8])})
for key,originals in [('secondarySurfaceMappings',inv['secondaryInterfaces']),('inlineSurfaceMappings',inv['inlineSurfaces'])]:
 for item,original in zip(d[key],originals):
  file=item['file'];txt=texts.get(file,'');links=[]
  for family in families:
   pat=re.compile(r'<'+re.escape(family['component'])+r'(?=[\s/>])');m=pat.search(txt)
   if m:links.append({'patternId':family['id'],'line':txt[:m.start()].count('\n')+1,'basis':'Exact primitive use; only reusable primitive behavior is reviewed, not child business action'})
  existing=feature_by_file[file];direct=manual_by_file[file]
  item['featureFragmentLinks']=existing;item['sharedContractIds']=direct;item['reusedPatternLinks']=links
  if direct:item['auditDepth']='SEMANTIC_SHARED_OR_CHILD_CONTRACT'
  elif existing:item['auditDepth']='REUSED_FEATURE_FILE_FRAGMENT'
  elif links:item['auditDepth']='REVIEWED_REUSED_PATTERN_ONLY'
  else:item['auditDepth']='PENDING_EXACT_SURFACE_REVIEW'
  item['ownershipBoundary']='Shared view owns presentation/focus only; mutation, tenant permission, entity/revision identity and persistence belong to its passed callback/store/API and are not certified by this mapping.'
  item['preciseMissingProof']=f"Read {file} export/inline action handlers beyond the cited fragment; trace callback through caller to authoritative mutation; verify busy/error/cancel/dirty and exact identity. Reused primitive or another export in the same file does not prove these."
  if key=='secondarySurfaceMappings':
   item['callerPointers']=usage[item['id']];item['screenContextIds']=sorted(set(c['screenId'] for c in usage[item['id']] if c['screenId']));item['mappingBasis']='Direct JSX callers with explicit screen ID only when caller is a primary screen; no path-family inference'
   # Constants retained as inventory entries, but not confused with interactive components.
   name=item['id'][4:];m=re.search(r'export const '+re.escape(name)+r'\s*=\s*([^;\n]+)',txt)
   if m and re.fullmatch(r"[\d.]+|'[^']*'|\"[^\"]*\"",m.group(1).strip()):item['surfaceKind']='NONINTERACTIVE_LITERAL_EXPORT';item['literalDeclaration']={'line':txt[:m.start()].count('\n')+1,'text':m.group(0)};item['preciseMissingProof']='Not an interactive interface: literal export. Its consuming geometry/style behavior is governed by the explicitly linked feature fragment or remains pending.'
  item['boundary']='Only named shared contract or exact feature-file fragment reused. This record remains incomplete for consumer-specific behavior; no runtime certification.'
d['sharedContractReviews']=families;d['coverage']['sharedContractsReviewed']=len(families)
for key,prefix in [('secondarySurfaceMappings','secondary'),('inlineSurfaceMappings','inline')]:
 d['coverage'][prefix+'AuditDepthCounts']=dict(collections.Counter(x['auditDepth'] for x in d[key]));d['coverage'][prefix+'OnlyPendingNoSemanticContext']=sum(x['auditDepth']=='PENDING_EXACT_SURFACE_REVIEW' for x in d[key]);d['coverage'][prefix+'ConsumerBehaviorComplete']=0
p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
with (r/'evidence/web-semantic-audit.md').open('a') as out:
 out.write('\n## Shared contracts and consumer coverage\n\nEach secondary and inline row now links exact reviewed feature-file fragments, directly used shared primitives, and/or precise remaining review. JSX use-sites are caller pointers only, not behavioral proof. No named reusable Drawer primitive was found in the checked common directory; drawer-like custom surfaces remain consumer-specific. Literal exports are retained but not counted as interactive UI.\n\n')
 for f in families:out.write(f"### {f['id']}\n{f['claim']}\n\n")
 out.write('Coverage: '+json.dumps(d['coverage'],ensure_ascii=False)+'\n')
# FM-01 proof supplied by independent reader: domain only.
x=next(x for x in fm['findings'] if x['id']=='FM-01');x.update(runtimeStatus='CONFIRMED_PURE_DOMAIN_REPRODUCTION',status='CONFIRMED_PURE_DOMAIN_REPRODUCTION',runtimeProofMissing='UI save/create/reload and API persistence remain unverified.',confidence='High: exact source and 3 real pure-domain assertions reproduce missing fields; UI/store end-to-end not executed.',impact='Reproduced loss of spaces, activeSpaceId, clearance, wall cabinet height and countertop settings in the returned template/project objects. Real persisted UI consequences remain unverified.');x['runtimeEvidence']=['data/template-roundtrip-proof.json','evidence/template-roundtrip-proof.log'];fm['features'][55]['runtimeEvidence']=[{'artifact':'data/template-roundtrip-proof.json','scope':'Pure conversion only; not full F056 acceptance'}]
(r/'data/feature-matrix.json').write_text(json.dumps(fm,ensure_ascii=False,indent=2)+'\n');print(d['coverage'])
