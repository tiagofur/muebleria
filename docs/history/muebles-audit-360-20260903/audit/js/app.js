'use strict';
(() => {
  const payload = window.AUDIT_DATA || { sources: {}, evidenceFiles: [] };
  const sha = '316df57c7c3c9d5470b5a3f22b39fffeacfd7676';
  const sections = [
    ['dashboard','Resumen ejecutivo','Decidir',[]],
    ['product','Producto y dominio','', ['product','domain','entities','productMap','productOverview','domainInvariants']],
    ['mvp','MVP y scorecard','', ['scorecard','scorecardRubric','mvpGaps','mvp']],
    ['demo','Demo y camino crítico','', ['fastestSafePath','demo','demoReadiness']],
    ['findings','Hallazgos','', ['findings']],
    ['architecture','Arquitectura','Examinar',['architecture','modules','graphs','architectureRecommendations']],
    ['web','Web y pantallas','', ['screens','routes','web','components','frontend','secondaryInterfaces','detailRoutes','inlineSurfaces','nonNavFlows','sharedContractReviews','componentReviewSources','secondaryReviews']],
    ['backend','Backend y servicios','', ['backend','services','modules']],
    ['sketchup','SketchUp','', ['sketchup']],
    ['integration','Integración y flujos','', ['integration','integrationMatrix','flows','verticalTraces','journeys','contractDrift','operationalIntegration']],
    ['three-d','3D · herrajes · mecanizado','', ['threeD','hardware','machining','cnc','benchmarks']],
    ['production','Producción e instalación','', ['production','installation','operationalFlows']],
    ['ux','UX / UI','', ['ux','ui','uxFindings','uxRecommendations']],
    ['security','Seguridad y tenancy','', ['security','tenancy','multitenancy']],
    ['database','Base de datos','', ['tables','retiredTables','migrations','database','semanticReview']],
    ['api','Catálogo API','', ['endpoints']],
    ['features','Funcionalidades','', ['features']],
    ['permissions','Permisos','', ['permissions','permissionMatrix','endpointAuthorityLedger']],
    ['tests','Tests · CI · operación','', ['tests','checks','quality','ci','deployment','observability','performance','proofs','testResult','constraints','runtime','operations','deploymentAudit','testAudit']],
    ['docs','Documentación','', ['documents','documentation','families','taxonomy']],
    ['issues','Issues y PRs','', ['issues','prs','githubScope']],
    ['risks','Registro de riesgos','Actuar',['risks']],
    ['debt','Deuda técnica','', ['technicalDebt','debt']],
    ['recommendations','Prioridades y quick wins','', ['tasks','recommendations','top10','top10Coverage','architectureRecommendations','uxRecommendations']],
    ['roadmap','Roadmap e issue plan','', ['roadmap','issuePlan']],
    ['decisions','Decisiones','', ['decisions']],
    ['manual','Manual por rol','', ['userManual']],
    ['playbook','Demo playbook','', ['demoPlaybook']],
    ['coverage','Cobertura y UNKNOWN','Verificar',['coverage','unknowns','limitations','filesInspected','fieldCoverage','distinctions','crossCuttingEvidence','runtimeProvenance','secondarySurfaceMappings','inlineSurfaceMappings']],
    ['evidence','Archivos de evidencia','', []],
    ['sources','Datos completos','', []]
  ];
  const labels = { title:'Título',id:'ID',name:'Nombre',description:'Descripción',status:'Estado',severity:'Severidad',confidence:'Confianza',classification:'Clasificación',evidence:'Evidencia',recommendation:'Recomendación',impact:'Impacto',currentBehavior:'Comportamiento actual',expectedBehavior:'Comportamiento esperado',businessImpact:'Impacto comercial',demoImpact:'Impacto demo',technicalImpact:'Impacto técnico',effort:'Esfuerzo',dependencies:'Dependencias',relatedFiles:'Archivos relacionados',relatedIssues:'Issues relacionados',relatedPRs:'PRs relacionados',missingEvidence:'Evidencia faltante',scope:'Alcance',assessment:'Evaluación',path:'Ruta',method:'Método',purpose:'Propósito',authorization:'Autorización',frontend:'Frontend',backend:'Backend',sketchup:'SketchUp',tests:'Pruebas',documentation:'Documentación',coverage:'Cobertura',unknowns:'Pendientes de verificación',evidenceLevel:'Nivel de evidencia',module:'Módulo',area:'Área',source:'Fuente',inspection:'Profundidad de inspección',proof:'Prueba',limitations:'Límites',snapshot:'Snapshot',baselineSha:'SHA base' };
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const human = key => labels[key] || key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ');
  const importanceLabel = value => value && typeof value==='object' ? String(value.level || value.status || '') : String(value || '');
  const rank = value => ({'DEMO BLOCKER':0,'MVP BLOCKER':1,'CRITICAL':2,'P0':2,'HIGH':3,'P1':3,'MEDIUM':4,'P2':4,'LOW':5,'P3':5,'FUTURE':6}[String(value).toUpperCase()] ?? 7);
  const safeURL = value => /^https?:\/\//i.test(value);
  function linkedText(value) {
    const text = String(value);
    if (safeURL(text) && !/\s/.test(text)) return `<a href="${esc(text)}" target="_blank" rel="noopener noreferrer">${esc(text)} ↗</a>`;
    if (/^assets\/[\w./ -]+\.(png|jpg|jpeg|webp)$/i.test(text)) return `<figure class="evidence-image"><a href="${esc(text)}" target="_blank" rel="noopener"><img src="${esc(text)}" alt="Captura de verificación: ${esc(text.split('/').pop())}" loading="lazy"></a><figcaption>${esc(text)} · Captura registrada; no es una vista en vivo.</figcaption></figure>`;
    if (/^data\/[\w.-]+\.json$/.test(text)) return `<a class="source-ref" href="${esc(text)}">${esc(text)} ↗</a>`;
    let internal=records.find(record=>record.row.id===text);if(internal?.replacedBy)internal=records.find(record=>record.key===internal.replacedBy);else if(internal?.duplicateOf)internal=records.find(record=>record.row.id===internal.duplicateOf&&!record.duplicateOf);
    if(internal){const target=sections.find(section=>section[3].includes(internal.group));if(target)return `<a href="#${target[0]}/${encodeURIComponent(internal.key)}">${esc(text)} →</a>`;}
    if (/^evidence\/[\w./ -]+$/.test(text)) return `<a class="source-ref" href="${esc(text)}">${esc(text)} ↗</a>`;
    const ref = text.match(/^((?:apps|packages|backend-go|contracts|docs|scripts|progress|\.agents)\/[\w./@ -]+|AGENTS\.md|feature_list\.json)(?::(\d+)(?:-(\d+))?)?$/);
    if (ref) {
      const anchor = ref[2] ? `#L${ref[2]}${ref[3] ? '-L'+ref[3] : ''}` : '';
      return `<a class="source-ref" href="https://github.com/tiagofur/muebleria/blob/${sha}/${ref[1].split('/').map(encodeURIComponent).join('/')}${anchor}" target="_blank" rel="noopener noreferrer">${esc(text)} ↗</a>`;
    }
    return esc(text);
  }
  function valueHTML(value) {
    if (value === null || value === undefined) return '<span class="unknown">No informado · UNKNOWN</span>';
    if (typeof value === 'boolean') return value ? 'Sí (según la fuente)' : 'No (según la fuente)';
    if (Array.isArray(value)) return value.length ? `<ul class="value-list">${value.map(v=>`<li>${valueHTML(v)}</li>`).join('')}</ul>` : '<span class="unknown">Lista vacía en la fuente; no prueba ausencia.</span>';
    if (typeof value === 'object') return `<dl class="fields">${Object.entries(value).map(([k,v])=>`<dt>${esc(human(k))}</dt><dd>${valueHTML(v)}</dd>`).join('')}</dl>`;
    return linkedText(value);
  }
  const records = [];
  Object.entries(payload.sources).forEach(([source,data])=>{
    Object.entries(data).forEach(([rawGroup,value])=>{
      const group = source.startsWith('web-secondary-') && rawGroup==='features' ? 'secondaryReviews' : rawGroup;
      const items = Array.isArray(value) ? value : [value];
      items.forEach((item,index)=>{
        const row = item && typeof item === 'object' && !Array.isArray(item) ? item : { value:item };
        const title = row.title || row.name || row.claim || row.feature || row.role && `${row.role} · ${row.resourceAction || row.resource || ''}` || row.method && `${row.method} ${row.path}` || row.path || row.file || row.id || `${human(group)} ${index+1}`;
        const status = typeof row.status === 'string' ? row.status : typeof row.classification === 'string' ? row.classification : typeof row.coverage === 'string' ? row.coverage : '';
        records.push({source,group,row,title:String(title),severity:({P0:'CRITICAL',P1:'HIGH',P2:'MEDIUM',P3:'LOW'}[String(row.severity||row.priority||'').toUpperCase()]||String(row.severity||row.priority||'')),status,module:String(row.module || row.area || source),mvp:importanceLabel(row.mvpImportance || row.mvp_importance || row['MVP importance']),key:`${source}--${group}--${index}`,search:JSON.stringify(item).toLocaleLowerCase('es')});
      });
    });
  });
  const canonicalPicking=records.find(r=>r.row.id==='BE-002');
  const duplicatePicking=records.find(r=>r.row.id==='WEB-01');
  if(canonicalPicking&&duplicatePicking){canonicalPicking.row={...canonicalPicking.row,corroboratingSource:{source:duplicatePicking.source,...duplicatePicking.row}};canonicalPicking.search=JSON.stringify(canonicalPicking.row).toLowerCase();duplicatePicking.duplicateOf='BE-002';}
  const canonicalListing=records.find(r=>r.row.id==='BE-004');const duplicateListing=records.find(r=>r.row.id==='OPS-08');if(canonicalListing&&duplicateListing){canonicalListing.row={...canonicalListing.row,corroboratingSource:{source:duplicateListing.source,...duplicateListing.row}};canonicalListing.search=JSON.stringify(canonicalListing.row).toLowerCase();duplicateListing.duplicateOf='BE-004';}
  for(const enriched of records.filter(r=>r.source==='feature-matrix'&&r.group==='features')){const ledger=records.find(r=>r.source==='docs-governance'&&r.group==='features'&&r.row.id===enriched.row.id);if(ledger){enriched.row={...enriched.row,originalLedgerRecord:ledger.row};ledger.duplicateOf=enriched.row.id;ledger.replacedBy=enriched.key;}}
  for(const deep of records.filter(r=>r.source==='endpoint-deep-audit'&&r.group==='endpoints')){const shallow=records.filter(r=>r.source==='backend-audit'&&r.group==='endpoints'&&r.row.method===deep.row.method&&r.row.path===deep.row.path);deep.row={...deep.row,originalInventoryRecords:shallow.map(r=>r.row)};for(const row of shallow){row.duplicateOf=deep.row.id;row.replacedBy=deep.key;}}
  for(const reviewed of records.filter(r=>r.source==='docs-semantic-audit'&&r.group==='documents')){
    const inventory=records.find(r=>r.source==='docs-governance'&&r.group==='documents'&&r.row.path===reviewed.row.path);
    if(inventory){reviewed.row={...reviewed.row,originalInventoryRecord:inventory.row};inventory.duplicateOf=reviewed.row.id;inventory.replacedBy=reviewed.key;}
  }
  for(const finalTable of records.filter(r=>r.source==='database-deep-audit'&&['tables','retiredTables'].includes(r.group))){
    const historical=records.find(r=>r.source==='backend-audit'&&r.group==='tables'&&r.row.name===finalTable.row.name);
    if(historical){finalTable.row={...finalTable.row,originalHistoricalRecord:historical.row};historical.duplicateOf=finalTable.row.id||finalTable.row.name;historical.replacedBy=finalTable.key;}
  }
  for(const fragment of records.filter(r=>['feature-fragments-ui','feature-fragments-extra'].includes(r.source)&&r.group==='features')){
    const canonical=records.find(r=>r.source==='feature-matrix'&&r.group==='features'&&r.row.id===fragment.row.id);
    if(canonical){canonical.row={...canonical.row,supplementalFeatureReview:{...(canonical.row.supplementalFeatureReview||{}),[fragment.source]:fragment.row}};fragment.duplicateOf=canonical.row.id;fragment.replacedBy=canonical.key;}
  }
  for(const supplement of records.filter(r=>r.source==='endpoint-supplement'&&r.group==='endpoints')){
    const originals=records.filter(r=>r.source==='backend-audit'&&r.group==='endpoints'&&r.row.method===supplement.row.method&&r.row.path===supplement.row.path);
    supplement.row={...supplement.row,originalInventoryRecords:originals.map(r=>r.row)};
    for(const original of originals){original.duplicateOf=supplement.row.id;original.replacedBy=supplement.key;}
  }
  for(const screen of records.filter(r=>r.source==='web-semantic-audit'&&r.group==='screens')){
    const original=records.find(r=>r.source==='web-inventory'&&r.group==='screens'&&r.row.id===screen.row.id);
    if(original){screen.row={...screen.row,originalInventoryRecord:original.row};original.duplicateOf=screen.row.id;original.replacedBy=screen.key;}
  }
  // Rebuild search indexes after enriching records so full preserved evidence stays searchable.
  records.forEach(record=>{record.search=JSON.stringify(record.row).toLocaleLowerCase('es');});
  let current = 'dashboard', selected = [];
  const get = id => document.getElementById(id);
  function sectionRecords(id) {
    if (id==='sources') return Object.entries(payload.sources).map(([source,row])=>({source,group:'complete',row,title:source,key:source,search:JSON.stringify(row).toLowerCase(),severity:'',status:'',module:source}));
    if (id==='evidence') return payload.evidenceFiles.map((file,index)=>({source:'evidence',group:'files',row:{path:file},title:file,key:`evidence-${index}`,search:file.toLowerCase(),severity:'',status:'',module:'evidence'}));
    const spec = sections.find(s=>s[0]===id);
    let result = records.filter(r=>spec[3].includes(r.group));
    if(id==='demo')result=result.concat(records.filter(r=>r.source==='guest-journey'&&r.group==='checks'));
    if(id==='production')result=result.concat(records.filter(r=>r.source==='operational-flows'&&['flows','findings','testHarnessEvidence'].includes(r.group)));
    if (id==='tests')result=result.concat(records.filter(r=>r.source==='operations-audit'&&['positiveControls','overallStatus'].includes(r.group)));
    if (id==='sketchup') result = records.filter(r=>r.source.includes('sketchup') && !['snapshot','filesInspected'].includes(r.group));
    if (id==='three-d') result = result.concat(records.filter(r=>r.source.includes('sketchup') && ['features','findings'].includes(r.group) && /hardware|machining|drill|dxf|3d/.test(r.search)));
    if (id==='security') result = result.concat(records.filter(r=>r.group==='findings' && /security|tenant|upload|auth|credential/.test(r.search)));
    if (id==='ux') result = result.concat(records.filter(r=>r.group==='findings' && /ux|ui|feedback|cancel|empty|navigation/.test(r.search)));
    if (id==='production') result = result.concat(records.filter(r=>['features','findings','flows'].includes(r.group) && /production|installation|producción|instalación/.test(r.search)));
    result=result.filter(r=>!r.duplicateOf);
    return [...new Map(result.map(r=>[r.key,r])).values()];
  }
  function navigation(){
    get('navigation').innerHTML=sections.map(([id,title,group])=>`${group?`<p class="nav-group">${group}</p>`:''}<a href="#${id}" ${id===current?'aria-current="page"':''}><span>${esc(title)}</span>${id==='dashboard'?'':`<span class="nav-count">${sectionRecords(id).length}</span>`}</a>`).join('');
  }
  function options(id,values,label){get(id).innerHTML=`<option value="">${label}</option>`+[...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b)).map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');}
  function recordHTML(record){
    const {row,title,key,source,group,severity,status}=record;
    return `<details class="entry" id="${esc(key)}"><summary><div class="summary-main"><div class="entry-title">${esc(title)}</div><div class="entry-meta">${esc(row.id ? row.id+' · ' : '')}${esc(source)} / ${esc(human(group))}</div></div><div class="badges">${severity?`<span class="badge ${rank(severity)<=2?'critical':rank(severity)===3?'high':''}">${esc(severity)}</span>`:''}${status?`<span class="badge">${esc(status)}</span>`:''}</div></summary><div class="entry-body"><div class="entry-actions"><a href="#${current}/${encodeURIComponent(key)}">Enlace a este registro</a><button type="button" data-copy="${esc(key)}">Copiar registro y referencias</button></div><div class="record-details"></div></div></details>`;
  }
  function dashboard(){
    const findings = records.filter(r=>r.group==='findings'&&!r.duplicateOf);
    const features = records.filter(r=>r.group==='features'&&!r.duplicateOf);
    const metrics = [['Hallazgos documentados',findings.length],['Bloqueos de demo',findings.filter(r=>r.severity==='DEMO BLOCKER').length],['Críticos / P0',findings.filter(r=>rank(r.severity)===2).length],['Altos / P1',findings.filter(r=>rank(r.severity)===3).length],['Medios / P2',findings.filter(r=>rank(r.severity)===4).length],['Bajos / P3',findings.filter(r=>rank(r.severity)===5).length],['Riesgos registrados',records.filter(r=>r.group==='risks').length]];
    const executive = records.filter(r=>r.group==='executive');
    get('results').innerHTML=`<div class="notice-panel"><strong>La evidencia manda sobre el estado del ledger.</strong><p>Este portal distingue inventario, inspección estática y verificación ejecutada. Los conteos siguientes describen registros, no porcentajes de preparación.</p><p><a href="#mvp">Preparación MVP y demo: consultar scorecard y límites →</a></p></div>${executive.map(r=>executiveHTML(r.row)).join('')}<div class="stats">${metrics.map(([label,count])=>`<div class="stat"><strong>${count}</strong><span>${label}</span></div>`).join('')}</div><h2>Síntesis íntegra y referencias</h2>${executive.map(r=>recordHTML({...r,title:'Síntesis ejecutiva completa'})).join('')}<h2>Estado funcional declarado en las fuentes</h2><p class="lede">${features.length} registros funcionales = ${payload.sources['feature-matrix']?.features?.length ?? 0} filas del ledger + ${payload.sources['sketchup-audit']?.features?.length ?? 0} capacidades suplementarias SketchUp. Las capacidades no son nuevas entradas del ledger. “done” histórico no se convierte en COMPLETE.</p><table class="overview-table"><thead><tr><th>Estado literal</th><th>Registros</th><th>Lectura</th></tr></thead><tbody>${Object.entries(features.reduce((acc,r)=>{const key=r.status||'UNKNOWN / no informado';acc[key]=(acc[key]||0)+1;return acc;},{})).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${v}</td><td>Clasificación de origen; revisar evidencia vertical.</td></tr>`).join('')}</tbody></table><h2>Mapa de lectura</h2><table class="overview-table"><thead><tr><th>Necesitás decidir</th><th>Ir a</th></tr></thead><tbody><tr><td>Qué mostrar y qué no prometer</td><td><a href="#playbook">Demo playbook</a> · <a href="#demo">Camino crítico</a></td></tr><tr><td>Qué reparar primero</td><td><a href="#findings">Hallazgos</a> · <a href="#recommendations">Prioridades</a></td></tr><tr><td>Qué está probado y qué falta</td><td><a href="#coverage">Cobertura y UNKNOWN</a> · <a href="#evidence">Evidencia original</a></td></tr><tr><td>Cómo navegar el producto real</td><td><a href="#manual">Manual por rol</a> · <a href="#web">Pantallas</a> · <a href="#api">API</a></td></tr></tbody></table>`;
    selected=executive;
    wireRecords();
  }
  function prose(label,content){return content?`<section class="reading-section"><h2>${esc(label)}</h2>${Array.isArray(content)?`<ul>${content.map(v=>`<li>${valueHTML(v)}</li>`).join('')}</ul>`:typeof content==='object'?valueHTML(content):`<p>${valueHTML(content)}</p>`}</section>`:'';}
  function executiveHTML(e){
    return `${prose('Snapshot auditado y main posterior',e.temporalScope)}<section class="verdict"><div class="verdict-label">¿Estamos listos para la demo integral?</div><strong>${esc(e.verdict||'UNKNOWN')}</strong><p>${esc(e.verdictScope||'')}</p></section><p class="executive-answer">${esc(e.answer||'')}</p>${prose('Estado real del producto',e.currentProductState)}<div class="reading-columns">${prose('Qué funciona, dentro de su alcance',e.whatWorks)}${prose('Qué parece más completo de lo que está',e.deceptivelyIncomplete)}</div>${prose('Primera decisión',e.firstAction)}${prose('Qué no hacer todavía',e.doNotDoYet)}${prose('Límite de confianza operativa',e.customerTrust)}<details class="editorial-evidence"><summary>Fuentes de la síntesis</summary>${valueHTML(e.evidence||[])}</details>`;
  }
  function stepHTML(step){return `<li><strong>${esc(step.action||step.title||'')}</strong>${Object.entries(step).filter(([k])=>!['step','action','title'].includes(k)).map(([k,v])=>`<p><b>${esc(human(k))}:</b> ${valueHTML(v)}</p>`).join('')}</li>`;}
  function graphsHTML(graphs){return graphs.map(g=>{const nodes=Object.fromEntries(g.nodes.map(n=>[n.id,n.label]));return `<section class="reading-section"><h2>${esc(g.title)}</h2><p class="lede">${esc(g.status||'')} · Las conexiones propuestas se distinguen por borde discontinuo.</p><div class="relationship-map">${g.edges.map(edge=>`<div class="relationship ${/PROPOSED/.test(edge.status||'')?'proposed':''}"><span class="graph-node">${esc(nodes[edge.from]||edge.from)}</span><span class="graph-edge"><span>${esc(edge.label)}</span><b aria-hidden="true">→</b><small>${esc(edge.status||'')}</small></span><span class="graph-node">${esc(nodes[edge.to]||edge.to)}</span></div>`).join('')}</div><details><summary>Evidencia del diagrama</summary>${valueHTML(g.evidence)}</details></section>`;}).join('');}
  function editorialHTML(section){
    const synth=payload.sources.synthesis||{};
    if(section==='features')return prose('Dos conjuntos, no un ledger inflado',`${payload.sources['feature-matrix']?.features?.length??0} entradas del ledger y ${payload.sources['sketchup-audit']?.features?.length??0} capacidades suplementarias SketchUp. Los fragmentos auxiliares se adjuntan a la entrada canónica; no agregan funcionalidades al ledger.`);
    if(section==='permissions'){const permissions=payload.sources['effective-permissions'];return prose('Matrices con alcances distintos','Los predicados role-only históricos, las composiciones efectivas por familia y el ledger de autoridad por registro API se muestran separados. Ninguna suma representa escenarios HTTP ejecutados ni una certificación de seguridad.')+prose('Cobertura efectiva',permissions?.coverage);}
    if(section==='api'){const api=payload.sources['endpoint-supplement'];const c=api?.coverage||{};return prose('Cómo leer el inventario API',`${c.inventoryTotal??'UNKNOWN'} registros mixtos: ${c.runtimeRegistrations??'UNKNOWN'} registros runtime (incluyen wildcards y health) y ${c.additionalOpenAPIDeclarations??'UNKNOWN'} declaraciones OpenAPI; no son endpoints runtime distintos. Los aliases pueden reutilizar handlers revisados.`)+prose('Cobertura del suplemento',c);}
    if(section==='database'){const db=payload.sources['database-deep-audit'];return db?prose('Esquema final observado',db.counts)+prose('Alcance de la lectura',db.snapshot)+prose('Tablas históricas retiradas',db.retiredTables):'';}
    if(section==='product')return prose('Granete y su propósito',synth.executive?.product)+prose('Modelo de producto',synth.product)+graphsHTML((synth.graphs||[]).filter(g=>/DOMAIN/.test(g.id)));
    if(section==='architecture'||section==='integration')return graphsHTML(synth.graphs||[]);
    if(section==='mvp')return prose('Cómo leer el scorecard',synth.scorecardRubric?.meaning)+prose('Lo que el score no permite concluir',synth.scorecardRubric?.aggregation)+`<table class="overview-table score-table"><thead><tr><th>Área</th><th>Banda ordinal</th><th>Evidencia y límite</th></tr></thead><tbody>${(synth.scorecard||[]).map(r=>`<tr><th>${esc(r.title)}</th><td><strong>${esc(r.score)} / 100</strong><br>${esc(r.status)}</td><td>${esc(r.description)}<details><summary>Qué falta probar</summary>${valueHTML(r.missingProof)}${valueHTML(r.evidence)}</details></td></tr>`).join('')}</tbody></table>`+prose('Gaps del MVP',synth.mvpGaps);
    if(section==='manual'){const manual=synth.userManual||{};return prose('Alcance del manual',manual.scope)+(manual.tutorials||[]).map(t=>`<article class="tutorial"><h2>${esc(t.title)}</h2><p><code>${esc(t.route||'')}</code> · ${esc(t.verification||t.status||'')}</p>${prose('Antes de empezar',t.prerequisites)}<ol class="steps">${(t.steps||[]).map(stepHTML).join('')}</ol>${prose('Resultado esperado',t.expectedResult)}${prose('Si algo falla',t.errorRecovery)}<div class="notice-panel"><b>Prueba pendiente</b><p>${esc(t.missingProof||'Consultar evidencia completa.')}</p></div></article>`).join('');}
    if(section==='playbook'){const demo=synth.demoPlaybook||{};return prose('Alcance del ensayo',demo.purpose)+prose('Requisitos antes de presentar',demo.prerequisites)+prose('Datos de demostración propuestos',demo.demoData)+`<h2>Happy path · guion de ensayo</h2><ol class="steps">${(demo.happyPath||[]).map(stepHTML).join('')}</ol>`+Object.entries(demo).filter(([k])=>!['status','readiness','purpose','prerequisites','demoData','happyPath'].includes(k)).map(([k,v])=>prose(human(k),v)).join('');}
    if(section==='demo'||section==='roadmap'){const steps=section==='demo'?synth.fastestSafePath:synth.roadmap;return `<ol class="steps roadmap">${(steps||[]).map(step=>`<li><h2>${esc(step.title)}</h2><p>${esc(step.description)}</p><p><b>Depende de:</b> ${step.dependencies?.length?valueHTML(step.dependencies):'Sin dependencia anterior en esta secuencia.'}</p>${step.exitProof?`<p><b>Evidencia de salida:</b> ${esc(step.exitProof)}</p>`:''}</li>`).join('')}</ol>`;}
    return '';
  }
  function wireRecords(){
    get('results').querySelectorAll('.entry').forEach(element=>element.addEventListener('toggle',()=>{
      if(element.open){const record=selected.find(r=>r.key===element.id);const container=element.querySelector('.record-details');if(record&&!container.dataset.loaded){container.innerHTML=valueHTML(record.row);container.dataset.loaded='true';}}
    }));
    get('results').querySelectorAll('[data-copy]').forEach(button=>button.addEventListener('click',async()=>{
      const record=selected.find(r=>r.key===button.dataset.copy);const text=JSON.stringify(record.row,null,2);
      let copied=false;button.textContent='Copiando…';try{await navigator.clipboard.writeText(text);copied=true;}catch{const area=document.createElement('textarea');area.value=text;document.body.append(area);area.select();try{copied=document.execCommand('copy');}catch{copied=false;}finally{area.remove();}}button.textContent=copied?'Copiado ✓':'No se pudo copiar';button.setAttribute('aria-label',copied?'Registro y referencias copiados':'Copia bloqueada; seleccioná el contenido manualmente');notify(copied?'Registro y referencias copiados.':'No se pudo copiar. Seleccioná el contenido del registro manualmente.');
    }));
  }
  let noticeTimer;
  function notify(text){get('notice').textContent=text;get('notice').style.display='block';clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>get('notice').style.display='none',4000);}
  function filter(){
    const query=get('search').value.toLocaleLowerCase('es').trim();
    selected=sectionRecords(current).filter(r=>(!query||(r.title+' '+r.search).toLowerCase().includes(query))&&(!get('severity').value||r.severity===get('severity').value)&&(!get('module').value||r.module===get('module').value)&&(!get('status').value||r.status===get('status').value)&&(!get('mvp').value||r.mvp===get('mvp').value));
    if(get('sort').value==='title')selected.sort((a,b)=>a.title.localeCompare(b.title));
    if(get('sort').value==='severity')selected.sort((a,b)=>rank(a.severity)-rank(b.severity));
    get('result-count').textContent=`${selected.length} de ${sectionRecords(current).length} registros · P1=HIGH, P2=MEDIUM; severidad original conservada en detalle. Expandí un registro para revisar todos sus campos y referencias.`;
    get('results').innerHTML=selected.length?editorialHTML(current)+`<h2>Registros completos y evidencia</h2>`+selected.map(recordHTML).join(''):editorialHTML(current)+`<div class="empty"><strong>${sectionRecords(current).length?'No hay coincidencias con estos filtros.':'UNKNOWN / NEEDS VERIFICATION'}</strong>${sectionRecords(current).length?'Limpiá los filtros o probá otra palabra.':'No hay una fuente estructurada asignada a esta sección en el paquete actual. Falta incorporar y verificar su análisis específico; el inventario de otras capas no lo sustituye.'}</div>`;
    wireRecords();
    try{sessionStorage.setItem('audit-filters-'+current,JSON.stringify(['search','severity','module','status','sort','mvp'].map(id=>get(id).value)));}catch{}
  }
  function navigate(){
    const [section,key]=location.hash.slice(1).split('/');current=sections.some(s=>s[0]===section)?section:'dashboard';
    const spec=sections.find(s=>s[0]===current);document.title=`${spec[1]} · Granete 360°`;navigation();
    get('heading').innerHTML=`<h1>${esc(spec[1])}</h1><p class="lede">${current==='dashboard'?'Una lectura crítica del producto, sus límites y el camino hacia una demo confiable.':current==='sources'?'Fuentes íntegras, sin recortar campos. Esta vista permite revisar también estructuras que todavía no tengan una sección específica.':'Fuente verificable primero. Los estados y conclusiones se conservan tal como fueron registrados; las limitaciones son parte del resultado.'}</p>`;
    get('filters').hidden=current==='dashboard';get('result-count').hidden=current==='dashboard';
    if(current==='dashboard'){dashboard();return;}
    const items=sectionRecords(current);options('severity',items.map(r=>r.severity),'Todas');options('module',items.map(r=>r.module),'Todos');options('status',items.map(r=>r.status),'Todos');options('mvp',items.map(r=>r.mvp),'Todas');get('mvp').parentElement.hidden=get('mvp').options.length<2;get('search').value='';get('sort').value='original';
    try{const previous=JSON.parse(sessionStorage.getItem('audit-filters-'+current));if(previous)['search','severity','module','status','sort','mvp'].forEach((id,index)=>get(id).value=previous[index]);}catch{}
    if(key){get('filters').reset();}
    filter();
    if(key){const element=get(decodeURIComponent(key));if(element){element.open=true;requestAnimationFrame(()=>element.scrollIntoView({block:'start'}));}}
  }
  get('filters').addEventListener('submit',event=>event.preventDefault());
  let searchTimer;get('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(filter,150);});
  ['severity','module','status','sort','mvp'].forEach(id=>get(id).addEventListener('change',filter));
  get('filters').addEventListener('reset',()=>setTimeout(filter,0));
  let printOpened=[];window.addEventListener('beforeprint',()=>{printOpened=[...get('results').querySelectorAll('details:not([open])')];printOpened.forEach(el=>{el.open=true;const record=selected.find(r=>r.key===el.id);if(record)el.querySelector('.record-details').innerHTML=valueHTML(record.row);});});
  window.addEventListener('afterprint',()=>printOpened.forEach(el=>el.open=false));get('print').addEventListener('click',()=>window.print());
  window.addEventListener('hashchange',navigate);navigate();
})();
