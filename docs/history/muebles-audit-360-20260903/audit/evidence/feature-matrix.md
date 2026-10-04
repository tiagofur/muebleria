# Current feature review coverage

204/204 rows have a bounded semantic implementation or historical/deferred scope review; **0 candidate-only rows**. {'PARTIAL': 200, 'UNKNOWN': 4}. **0 COMPLETE**. Per-layer candidate pointers and unexecuted acceptance remain; reading a fragment is not full-feature verification. Earlier pass counts below are historical checkpoints.

# Feature matrix — 204 ledger records, evidence-bounded

**Coverage is a map, not a completion certificate.** All 204 source ledger records are retained with frontend/backend/SketchUp/tests, intended users, documentation, priorities, problems, recommendations, issue/PR associations and each original acceptance criterion. No ledger `done` becomes COMPLETE.

## What is verified vs indexed
- 64 rows contain a specifically reviewed implementation fragment; their status is PARTIAL, not end-to-end verified.
- 140 rows retain UNKNOWN with source/search evidence and exact missing semantic/runtime proof. They are not omitted or relabeled complete.
- 1735 source/config files searched; 956 files had excerpts extracted. Extraction is not a full human/agent semantic read.
- `FM-SEM-*` evidence records identify the reviewed bounded fragments. `evidenceIndex` separates these from exact feature/issue markers, explicit paths, sibling tests, filename candidates and generic-document pointers.
- Canonical-document references are NOT sufficient to associate every file in that document with a feature. Those broad pointers remain CANDIDATE_ONLY.
- Tests are located but not executed by this task. Every acceptance criterion retains NEEDS VERIFICATION.
- N/A is explained per layer and means not required by the original feature scope, not absence of underlying dependencies.

## Bounded group findings
| Group | Evidence-bounded conclusion | Next proof |
|---|---|---|
| Quote/customer | Customer ownership checks, quote UI, frozen TS prices are present. OP-01 and OP-03 undermine server freeze/persisted success. | Same-status snapshot tamper/omission, save failure, reload. |
| Production/materials | Dedicated part/unit/gate endpoints coexist with generic writer OP-02 and picking gap WEB-01. | Same-org generic gate bypass prevention, concurrent stale save, atomic dispatch. |
| Installation | Dedicated job/closeout gates and lock+audit are present; underlying physical writer must be protected. | Real routed DB visit→units→punch→sign-off→close. |
| Web catalogs/settings | Validation and reusable shells exist; WEB-03/04 affect load and saved feedback. | Error-state, asynchronous persistence, role and reload checks. |
| UI infrastructure | Shared Modal/focus filtering and app extraction are source-confirmed fragments. | Every caller focus/keyboard/viewport, no score from presence. |
| Auth/Team | Current invitation-first replaces old F026 scope; step-up cancellation must not claim success (WEB-02). | Exact sensitive-command cancellation and real tenant switch. |
| SketchUp | Loader/native builder/layout/selection contracts exist; host behavior is not inferred. | Installed RBZ TestUp + exact identity/undo/save-reopen. |
| Digital Thread | Materialization distinguishes immutable accepted quote/history; working-copy PUT is full replacement. | Quantity N→N identities, merging/rollback and exact binding in real host. |

## Historical scope traps
- F026: old self-registration/admin approval must not be presented as current invitation-first behavior.
- F078/F079: frozen old exporter/premium render scope is not completed by newer adjacent work.
- F081: re-scoped to F127–F132; each replacement is assessed separately.
- F132: native SCM remains explicitly deferred until exact machine/software evidence; no generic machine-ready claim.

## Complete row index
Each row below has the detailed layer/acceptance matrix in `data/feature-matrix.json`. A file anchor is a fragment or search lead—not a passed criterion.

| ID | Feature | Audit status | Best exact source / search lead |
|---|---|---|---|
| F001 | Scaffold monorepo TypeScript | UNKNOWN | apps/web/src/routes.ts:8 (indexed; verify) |
| F002 | Entidades del dominio (tipos TypeScript) | PARTIAL | packages/domain/src/types.ts:18 (fragment) |
| F003 | Motor de dominio: resolución BOM + costos | PARTIAL | packages/domain/src/engine/pricing.ts:390 (fragment) |
| F004 | Export Optimizer XLSX | UNKNOWN | apps/web/src/exportOptimizer.ts:14 (indexed; verify) |
| F005 | Capa de persistencia JSON versionada | UNKNOWN | packages/storage/src/workspace.ts:3 (indexed; verify) |
| F006 | UI — Catálogos (materiales, cantos, herrajes) | PARTIAL | packages/ui/src/catalogs/hardware/HardwareCatalog.tsx:150 (fragment) |
| F007 | UI — Grupos de opciones | PARTIAL | packages/ui/src/optionGroups/OptionGroupsScreen.tsx:222 (fragment) |
| F008 | UI — Editor de mueble (módulo plantilla) | PARTIAL | packages/ui/src/modules/components/ModuleEditorForm.tsx:39 (fragment) |
| F009 | UI — Cotización y proyectos | PARTIAL | packages/ui/src/projects/ProjectsScreen.tsx:55 (fragment) |
| F010 | UI — Export Optimizer desde interfaz | UNKNOWN | packages/ui/src/projects/ProjectsScreen.tsx:234 (indexed; verify) |
| F011 | Datos semilla completos (MOD-GAB-01, MOD-CAJ-01, catálogos) | UNKNOWN | apps/web/src/App.test.ts:245 (indexed; verify) |
| F012 | Snapshot de cotización (congelar precios al cerrar) | PARTIAL | packages/domain/src/engine/pricing.ts:399 (fragment) |
| F013 | Export lista de herrajes | PARTIAL | packages/excel/src/hardwareListExport.ts:63 (fragment) |
| F014 | Merma % por material | UNKNOWN | packages/domain/src/engine.test.ts:435 (indexed; verify) |
| F015 | Duplicar módulo / proyecto | UNKNOWN | packages/ui/src/projects/ProjectsScreen.tsx:108 (indexed; verify) |
| F016 | UI — Design system: tokens, reset, Inter, Lucide | UNKNOWN | apps/web/index.html:1 (indexed; verify) |
| F017 | UI — Layout: sidebar + top bar (reemplaza tabs) | UNKNOWN | packages/ui/src/shell/appShell.css:1 (indexed; verify) |
| F018 | UI — Componente Modal reutilizable | PARTIAL | packages/ui/src/common/Modal.tsx:42 (fragment) |
| F019 | UI — Sistema de toasts / notificaciones | UNKNOWN | apps/web/index.html:1 (indexed; verify) |
| F020 | UI — Catálogos refactorizados: lista + búsqueda + modal | PARTIAL | packages/ui/src/catalogs/materials/MaterialsCatalog.tsx:567 (fragment) |
| F021 | UI — Muebles: cards + vista detalle + modal editor | PARTIAL | packages/ui/src/modules/ModulesScreen.tsx:37 (fragment) |
| F022 | UI — Cotizaciones: cards ricas + detalle de proyecto + modales | PARTIAL | packages/ui/src/projects/ProjectsScreen.tsx:55 (fragment) |
| F023 | UI — Dashboard / Home (pantalla de inicio) | PARTIAL | packages/ui/src/dashboard/Dashboard.tsx:218 (fragment) |
| F024 | Backend Go + Postgres, Auth y Gestión de Clientes | PARTIAL | backend-go/internal/api/routes.go:249 (fragment) |
| F025 | Categorización Jerárquica de Muebles (3 Niveles) | UNKNOWN | packages/ui/src/modules/modules.css:1 (indexed; verify) |
| F026 | Registro con aprobación admin y roles | PARTIAL | apps/web/src/SessionGate.tsx:12 (fragment) |
| F027 | Cintilla default por id en material + alta rápida | UNKNOWN | packages/ui/src/catalogs/materials/MaterialsCatalog.tsx:1 (indexed; verify) |
| F028 | Veta (grain) heredada del material, no por pieza | UNKNOWN | backend-go/db/migration/000005_grain_to_material.up.sql:3 (indexed; verify) |
| F029 | Opciones a nivel proyecto + override por línea | UNKNOWN | packages/ui/src/projects/projects.css:1 (indexed; verify) |
| F030 | Export cotización comercial (Excel simple) | UNKNOWN | apps/web/src/exportCommercialQuote.ts:1 (indexed; verify) |
| F031 | Pantalla Ajustes: defaults globales del taller | PARTIAL | packages/ui/src/settings/SettingsScreen.tsx:170 (fragment) |
| F032 | Desktop Electron: host empaquetado usable | UNKNOWN | apps/desktop/src/main.test.ts:22 (indexed; verify) |
| F033 | UX grillas: atajos de teclado básicos | UNKNOWN | packages/ui/src/modules/modules.css:1 (indexed; verify) |
| F034 | Ownership de clientes/proyectos + aislamiento vendedor | PARTIAL | backend-go/internal/api/handlers.go:1039 (fragment) |
| F035 | Roles de producto + matriz RBAC en API y UI | PARTIAL | packages/domain/src/rbac.ts:567 (fragment) |
| F036 | Status produced + reopen/delete (gerente) | PARTIAL | backend-go/internal/api/handlers.go:1445 (fragment) |
| F037 | Dashboard gerente: total + por owner | UNKNOWN | packages/ui/src/dashboard/Dashboard.tsx:75 (indexed; verify) |
| F038 | Cola producción: accepted → export → produced | PARTIAL | packages/ui/src/production/ProductionWorkspace.tsx:173 (fragment) |
| F039 | Costos ocultos al vendedor (COST-01) | UNKNOWN | packages/ui/src/projects/ProjectsScreen.tsx:307 (indexed; verify) |
| F040 | Imágenes de catálogo + vitrina de muebles | UNKNOWN | apps/web/src/stores/catalog/media.ts:1 (indexed; verify) |
| F041 | Ingeniero: acceso a exports de producción | UNKNOWN | packages/ui/src/projects/ProjectsScreen.tsx:614 (indexed; verify) |
| F042 | Subida de imagen en materiales y herrajes | UNKNOWN | apps/web/src/stores/catalog/media.ts:1 (indexed; verify) |
| F043 | Pulir vitrina de muebles y home por rol | UNKNOWN | packages/ui/src/dashboard/Dashboard.tsx:2 (indexed; verify) |
| F044 | Flag taller: vendedor puede ver costos (COST-02) | UNKNOWN | apps/web/src/derivations/useQuoteDerivations.ts:68 (indexed; verify) |
| F045 | Export cotización comercial en PDF | UNKNOWN | apps/web/src/exportCommercialQuotePdf.ts:1 (indexed; verify) |
| F046 | Etiquetas de pieza con instrucción de encintado | UNKNOWN | apps/web/src/exportPieceLabels.ts:1 (indexed; verify) |
| F047 | Resumen de materiales del proyecto (m² y herrajes) | UNKNOWN | packages/ui/src/projects/ProjectsScreen.tsx:219 (indexed; verify) |
| F048 | Lista de corte Optimizer enriquecida (códigos/etiquetas) | UNKNOWN | backend-go/internal/domain/types.go:832 (indexed; verify) |
| F049 | Estructuras: cuerpos reutilizables en Ingeniería | UNKNOWN | packages/storage/src/apiMappers.ts:636 (indexed; verify) |
| F051 | Cotización: preset de medida del mueble | UNKNOWN | packages/ui/src/modules/helpers/moduleDraftTransforms.ts:107 (indexed; verify) |
| F055 | Parámetros de medida a nivel proyecto (por tipo de mueble) | UNKNOWN | packages/storage/src/apiMappers.ts:1518 (indexed; verify) |
| F056 | Plantillas de proyecto (ej. cocina 3 m) | UNKNOWN | packages/storage/src/seed.ts:23 (indexed; verify) |
| F057 | workspaceStore Zustand: sesión + load workspace + RBAC + workshopSettings | PARTIAL | apps/web/src/stores/workspaceStore.ts:850 (fragment) |
| F062 | catalogStore Zustand: catálogos + módulos + estructuras + componentes + customers | PARTIAL | apps/web/src/stores/catalog/customers.ts:14 (fragment) |
| F063 | projectStore Zustand: proyectos + items + templates + backend breakdown | PARTIAL | apps/web/src/stores/projectStore.ts:695 (fragment) |
| F064 | uiStore Zustand: toasts (reemplaza ToastProvider) + exportBusy/errors + createKeys + command palette | UNKNOWN | apps/web/src/stores/uiStore.ts:18 (indexed; verify) |
| F058 | Partir ProjectsScreen (2793 L) en lista + detalle + exports | PARTIAL | packages/ui/src/projects/ProjectsScreen.tsx:60 (fragment) |
| F059 | Abstraer EntityEditorLayout<Tab,Draft> común (Modules/Structures/Components) | UNKNOWN | packages/ui/src/modules/ModulesScreen.tsx:44 (indexed; verify) |
| F060 | Partir engine.ts (2108 L) por responsabilidad | UNKNOWN | packages/domain/src/index.test.ts:1 (indexed; verify) |
| F061 | Command pattern + undo/redo sobre mutaciones de proyecto | UNKNOWN | packages/ui/src/common/useUndoRedo.ts:3 (indexed; verify) |
| F065 | Proyectar: drag-drop mejorado de ítem 'sin colocar' al muro/piso | UNKNOWN | packages/ui/src/projects/components/ProjectSpatialStudio.tsx:211 (indexed; verify) |
| F066 | Inspector 3D rediseñado con secciones colapsables | UNKNOWN | packages/ui/src/preview3d/PartInspector.tsx:22 (indexed; verify) |
| F067 | Paleta de materiales con aplicación por drag (piso/muro/pieza) | UNKNOWN | packages/ui/src/preview3d/AmbientMeshes.tsx:34 (indexed; verify) |
| F068 | Geometrías 3D de herrajes: bisagra, corredera, riel, pata | UNKNOWN | packages/ui/src/preview3d/HardwareMesh.tsx:23 (indexed; verify) |
| F069 | Variantes de acabado para herrajes (cromado/negro/bronce/mate) | UNKNOWN | packages/storage/src/apiMappers.ts:390 (indexed; verify) |
| F070 | Editor de placement de herrajes en 3D (gizmo interactivo) | UNKNOWN | packages/ui/src/preview3d/HardwareMesh.tsx:23 (indexed; verify) |
| F071 | Etiquetas Zebra/ZPL para impresoras térmicas (1-3 tamaños) | UNKNOWN | apps/web/src/exportProductionPack.ts:200 (indexed; verify) |
| F072 | PDF preview de corte visual para cortes manuales | UNKNOWN | packages/ui/src/production/ProductionBoardView.tsx:29 (indexed; verify) |
| F073 | CSV de plan de corte editable y configurable | UNKNOWN | packages/ui/src/editor/boardCostSummary.css:1 (indexed; verify) |
| F074 | Lista de piezas con perforaciones como datos estructurados | UNKNOWN | apps/web/src/components/BoardEditor.tsx:93 (indexed; verify) |
| F075 | Electron empaquetado + firma Windows + auto-update | UNKNOWN | apps/desktop/src/main.test.ts:55 (indexed; verify) |
| F076 | Onboarding + datos semilla para demo comercial | UNKNOWN | packages/ui/src/index.ts:428 (indexed; verify) |
| F077 | Prep venta: pricing tiers + landing + script de venta | UNKNOWN | NEEDS VERIFICATION — no exact source resolved; full search terms recorded |
| F078 | SketchUp plugin (exportador modelo → API) [CONGELADO] | UNKNOWN | NEEDS VERIFICATION — no exact source resolved; full search terms recorded |
| F079 | Render backend Blender headless (premium) [CONGELADO] | UNKNOWN | NEEDS VERIFICATION — no exact source resolved; full search terms recorded |
| F080 | Capas de acabado por componente de herraje | UNKNOWN | packages/storage/src/apiMappers.ts:400 (indexed; verify) |
| F081 | Perforaciones dinámicas tipo Promob Builder [RE-ESCOPEADO → F127–F132] | UNKNOWN | apps/web/src/App.tsx:35 (indexed; verify) |
| F082 | Motor paramétrico de sub-espacios locales y apilamiento de agregados (#294) | UNKNOWN | packages/domain/src/types.test.ts:1 (indexed; verify) |
| F083 | Interfaz de usuario para vincular agregados a muebles (#295) | PARTIAL | packages/ui/src/structures/components/StructureEditorAgregadosPanel.tsx:17 (fragment) |
| F084 | Visualización y jerarquía 3D interactiva de sub-ensambles (#296) | PARTIAL | packages/ui/src/agregados/editor/AgregadoEditorPreview3D.tsx:14 (fragment) |
| F085 | Integración en cotizaciones, export optimizer y persistencia (#297) | PARTIAL | packages/excel/src/optimizerExport.ts:8 (fragment) |
| F086 | Catálogo de Acabados 3D: jerarquía de 3 niveles, desacoplamiento y RBAC | UNKNOWN | apps/web/src/stores/catalog/ambient.ts:1 (indexed; verify) |
| F087 | Zócalo como terminación automática: una sola decisión con acabado elegible y 3D real | UNKNOWN | packages/storage/src/apiMappers.ts:1686 (indexed; verify) |
| F088 | Zócalo con vueltas laterales automáticas, espesor real y textura/veta en 3D | UNKNOWN | packages/ui/src/preview3d/project3dPreview.ts:68 (indexed; verify) |
| F089 | Escaneo QR en Piso de Fábrica (Lector USB / Cámara y transiciones de estado) | UNKNOWN | packages/ui/src/production/production.css:1375 (indexed; verify) |
| F090 | Métricas y Analytics del Taller (Tasas de Conversión Comercial y Garantías Post-Venta) | UNKNOWN | apps/web/src/AppContent.tsx:1172 (indexed; verify) |
| F091 | App compañera React Native + variante URL del payload QR (deep link) | UNKNOWN | packages/ui/src/production/labelPrinterSettings.ts:13 (indexed; verify) |
| F092 | Producción por sectores: ProductionSector + bitácora FloorStatusEvent (Fase 0 del plan sectores/roles) | UNKNOWN | apps/web/src/exportModuleLabels.ts:1 (indexed; verify) |
| F093 | Visibilidad de fábrica para todos: franja de procesos + tablero Estado de Planta (Fase 1 del plan sectores/roles) | PARTIAL | packages/ui/src/production/PlantBoardScreen.tsx:43 (fragment) |
| F094 | Fase 2 sectores/roles: separación de funciones por rol, avance por estación asignada y pantalla Mi Estación | UNKNOWN | apps/web/src/AppContent.tsx:639 (indexed; verify) |
| F095 | Fase 5.1+5.2 (M3): métricas de encintado en dominio + color de cintilla + claim obra×estación | UNKNOWN | backend-go/internal/domain/types.go:200 (indexed; verify) |
| F096 | FabricScreen v2 — board por obra | PARTIAL | packages/ui/src/production/FabricScreen.tsx:217 (fragment) |
| F097 | Producción — dashboard honesto y estado de surtido visible | PARTIAL | packages/ui/src/production/ProductionManagerDashboard.tsx:194 (fragment) |
| F098 | Instalaciones — dirección y contacto del cliente en cards | PARTIAL | packages/ui/src/production/InstalacionesScreen.tsx:20 (fragment) |
| F099 | Polish final del módulo Producción | UNKNOWN | apps/web/index.html:1 (indexed; verify) |
| F100 | Area Tonal Theme Foundation | UNKNOWN | apps/web/src/App.tsx:35 (indexed; verify) |
| F101 | Page Chrome, Toolbar & Action Hierarchy | UNKNOWN | packages/ui/src/common/pageHeader.css:1 (indexed; verify) |
| F102 | Semantic Tabs: two patterns, one workspace family | UNKNOWN | packages/ui/src/common/tabs.css:1 (indexed; verify) |
| F103 | UI/UX Documentation Sync & Executable Source Contract | UNKNOWN | apps/web/src/routes.ts:8 (indexed; verify) |
| F104 | Page Chrome Rollout I: Catálogos y Librería | UNKNOWN | packages/ui/src/common/PageHeader.tsx:11 (indexed; verify) |
| F105 | Page Chrome Rollout II: Ventas y Trabajo | UNKNOWN | packages/ui/src/production/PlantBoardScreen.tsx:17 (indexed; verify) |
| F106 | Page Chrome Rollout III: Producción, Almacén y Config | UNKNOWN | packages/ui/src/shell/AppShell.tsx:391 (indexed; verify) |
| F107 | Área tonal calibrada: atmósfera perceptible con pares AA | UNKNOWN | packages/ui/src/shell/appShell.css:1 (indexed; verify) |
| F108 | Contraste AA de texto y warning (medido, no estimado) | UNKNOWN | packages/ui/src/auth/login.css:1 (indexed; verify) |
| F109 | Semantic Tabs Rollout: 15 implementaciones locales → 2 patrones | UNKNOWN | packages/ui/src/common/Tabs.tsx:7 (indexed; verify) |
| F110 | Overlays al contrato único: Modal + FullscreenDialog | PARTIAL | packages/ui/src/common/Modal.tsx:13 (fragment) |
| F111 | Vocabularios y sistema (P2): badges, stats, touch, labels, z-index | UNKNOWN | packages/ui/src/shell/AppShell.tsx:61 (indexed; verify) |
| F112 | Área Library (Catálogos + Librería) en oliva/sage | UNKNOWN | packages/ui/src/shell/AppShell.tsx:61 (indexed; verify) |
| F113 | Separación de cola operativa de Ingeniería y creación del Dashboard de Ingeniería | PARTIAL | packages/ui/src/engineering/EngineeringDashboard.tsx:129 (fragment) |
| F114 | Separación de cola operativa de Almacén y creación del Dashboard de Almacén | PARTIAL | packages/ui/src/purchasing/WarehouseDashboard.tsx:97 (fragment) |
| F115 | Motor de optimización de plan de corte 2D guillotina, conteo exacto de almacén, PDF de taller y persistencia | UNKNOWN | packages/ui/src/production/ProductionOrderOptimizationPanel.tsx:29 (indexed; verify) |
| F116 | Bugfixes críticos de catálogos (pérdida de datos silenciosa + paridad seed) | UNKNOWN | apps/web/src/stores/catalogStore.ts:32 (indexed; verify) |
| F117 | Refactor: partir archivos grandes de catálogos (UI + store) sin cambio de comportamiento | UNKNOWN | apps/web/src/stores/catalogStore.ts:32 (indexed; verify) |
| F118 | Bugfixes críticos del shell (clobber de workspace, carreras de sesión, nav rota) | PARTIAL | apps/web/src/stores/workspaceStore.ts:850 (fragment) |
| F119 | Refactor del shell: runExport, purchasingStore, derivaciones y render — App.tsx < 800 L | PARTIAL | apps/web/src/App.tsx:35 (fragment) |
| F120 | Shell slim fase 2: split de render de App.tsx (< 800 L) + módulo de derivaciones + confirmFabricBatch modal | PARTIAL | apps/web/src/ShellView.tsx:965 (fragment) |
| F121 | Shell render split: App.tsx < 1500 vía componentes por área con contexto agrupado | PARTIAL | apps/web/src/App.tsx:35 (fragment) |
| F122 | Bugfixes críticos de inventario Compras/Almacén (doble reintegro, colisión de OC, recepción libre) | PARTIAL | apps/web/src/stores/purchasingStore.ts:358 (fragment) |
| F123 | Hardening + tests de Compras/Almacén (store tests, integración Go, UX pendientes) | PARTIAL | apps/web/src/stores/purchasingStore.ts:358 (fragment) |
| F124 | Estrategia de corte CNC nesting: motor MaxRects no-guillotina + tool spacing | UNKNOWN | packages/ui/src/production/ProductionBoardView.tsx:57 (indexed; verify) |
| F125 | Exportador DXF R12 para plan de corte nesting (tableros nesteados + piezas sueltas) | UNKNOWN | apps/web/src/exportCutPlanDxf.ts:1 (indexed; verify) |
| F126 | UI: selector de tipo de corte (Sierra / CNC Nesting) y despacho exclusivo de export (XLSX+PDF vs DXF) | UNKNOWN | packages/ui/src/engineering/EngineeringWorkspace.tsx:68 (indexed; verify) |
| F127 | Perfiles de maquinado en catálogo de herrajes (perforaciones CNC — 1/5) | UNKNOWN | packages/storage/src/apiMappers.ts:402 (indexed; verify) |
| F128 | Motor de resolución: placements + perfiles → agujeros por pieza (perforaciones CNC — 2/5) | UNKNOWN | apps/web/src/exportProductionPack.ts:157 (indexed; verify) |
| F129 | Reglas de unión paramétricas sistema 32 (perforaciones CNC — 3/5) | UNKNOWN | packages/storage/src/apiMappers.ts:978 (indexed; verify) |
| F130 | Export DXF de perforaciones por cara + reporte (perforaciones CNC — 4/5) | UNKNOWN | apps/web/src/exportProductionPack.ts:34 (indexed; verify) |
| F131 | Editor visual 2D de perforaciones por cara + gizmo 3D (perforaciones CNC — 5/5) | UNKNOWN | packages/ui/src/modules/components/HardwarePlacementsEditor.tsx:14 (indexed; verify) |
| F132 | Post-procesador SCM nativo (.xcs/MSL) [POSTERGADO hasta confirmar máquina] | UNKNOWN | NEEDS VERIFICATION — no exact source resolved; full search terms recorded |
| F133 | Tipo de corte por defecto del taller (sierra / nesting) | PARTIAL | packages/ui/src/settings/SettingsScreen.tsx:80 (fragment) |
| F134 | Issue #299 — Operational Core O0: guardrails, roles canónicos, auth hardening y Data Truth (OC-001..OC-006) | PARTIAL | packages/domain/src/rbac.ts:567 (fragment) |
| F135 | Issue #300 — Operational Core O1: Lifecycle, Approvals, Production Release y Change Orders (OC-010..OC-024) | PARTIAL | packages/domain/src/projectVersioning.ts:94 (fragment) |
| F136 | Issue #301 — Operational Core O2: Producción física: piezas hasta Enchape, muebles desde Armado (OC-030..OC-034) | PARTIAL | backend-go/internal/api/partExecutions.go:165 (fragment) |
| F137 | Issue #303 — Operational Core O4: Instalación profesional, Field Issues, Punch y Closeout (OC-070..OC-074) | PARTIAL | backend-go/internal/api/installation.go:61 (fragment) |
| F138 | Issue #302 — Operational Core O3: MRP ligero, reservas, compras, QC y retrabajo (OC-050..OC-054, OC-060..OC-062) | PARTIAL | apps/web/src/stores/purchasingStore.ts:358 (fragment) |
| F139 | Issue #304 — Operational Core O5: Job Costing, estimado vs real por obra (OC-080..OC-084) | UNKNOWN | apps/web/src/ShellView.tsx:445 (indexed; verify) |
| F140 | Issue #305 — Operational Core UX: Site Survey, Project Workspace y dashboards exception-first (OC-040/041, OC-090..OC-092) | UNKNOWN | apps/web/src/ShellView.tsx:453 (indexed; verify) |
| F141 | Issue #309 P3D-0a — Biblioteca lateral persistente de muebles en Proyectar (meta #308, etapa E1) | UNKNOWN | packages/ui/src/preview3d/paintMaterial.ts:11 (indexed; verify) |
| F142 | Issue #309 P3D-0b — Dock de materiales Ambiente/Tableros + fabricante/subgrupos + scopes (meta #308, etapa E2) | UNKNOWN | packages/ui/src/preview3d/MaterialPalette.tsx:25 (indexed; verify) |
| F143 | Issue #310 P3D-1a — Selección multi/jerárquica + clipboard/align en Proyectar (meta #308, etapa E3) | UNKNOWN | packages/ui/src/preview3d/FurnitureScene3D.tsx:102 (indexed; verify) |
| F144 | Issue #310 P3D-1b — Precisión + dimensiones libres + undo por intención en Proyectar (meta #308, etapa E4) | UNKNOWN | packages/ui/src/preview3d/FurnitureScene3D.tsx:102 (indexed; verify) |
| F145 | Issue #311 P3D-4 — Environment authoring + multi-ambiente 5★ en Proyectar (meta #308, etapa E5) | UNKNOWN | packages/storage/src/apiMappers.ts:146 (indexed; verify) |
| F146 | Issue #313 P3D-7 — Contract tests diseño→BOM→precio→producción (meta #308) | UNKNOWN | backend-go/internal/domain/engine/resolve.go:25 (indexed; verify) |
| F147 | Issue #312 P3D-6 — Performance budget y escena de referencia para Proyectar 3D (meta #308) | UNKNOWN | packages/ui/src/preview3d/perfTelemetry.ts:18 (indexed; verify) |
| F148 | Issue #314 P3D-8 — Kit de benchmark de usabilidad 5★: instrumentación, protocolo y validación proxy (meta #308) | UNKNOWN | packages/ui/src/preview3d/usabilityBenchmark.ts:16 (indexed; verify) |
| F149 | Eliminar muebles desde Proyectar con alcance explícito: sólo del plano 3D o también de la lista de muebles (meta #308) | UNKNOWN | apps/web/src/stores/projectStore.ts:195 (indexed; verify) |
| F150 | Paridad de listas: la card abre el detalle con click en su cuerpo (stretched link) en Órdenes, Instalaciones y Embarques | UNKNOWN | packages/ui/src/production/EmbarquesScreen.tsx:31 (indexed; verify) |
| F151 | Paridad visual con Ingeniería: cards de línea completa limpias en reposo, acciones compactas reveladas en hover (cola de Órdenes) | UNKNOWN | packages/ui/src/common/cardOpen.css:1 (indexed; verify) |
| F152 | Bug routing: deep-link/F5 en /modules/:id rebota a la lista y cierre de editor deja URL en /edit | UNKNOWN | packages/ui/src/modules/helpers/useModulesScreenState.ts:127 (indexed; verify) |
| F153 | Bug #338: render loop (~55 remontajes/s) en Cotizaciones con guest + proyecto seleccionado + reload | UNKNOWN | packages/ui/src/projects/helpers/useProjectsScreenState.ts:45 (indexed; verify) |
| F154 | Paridad UX: chevron de affordance en tablas expandibles de catálogo (hallazgo P1 de la auditoría 2026-08-23) | UNKNOWN | packages/ui/src/catalogs/catalogs.css:1 (indexed; verify) |
| F155 | Paridad UX: Estructuras mueve Desactivar/Eliminar al overflow "Más" del chrome (hallazgo P2 #4) | UNKNOWN | packages/ui/src/modules/components/ModuleDetailView.tsx:30 (indexed; verify) |
| F156 | Paridad UX: placeholder 'Sin foto' decorativo + verificación P2 #3 headings ya resuelto (hallazgos P3 #5 y P2 #3 de la auditoría) | UNKNOWN | packages/ui/src/common/CatalogImage.tsx:7 (indexed; verify) |
| F157 | #256 Producción Vistas: planta y 3D respetan el scope multi-ambiente (sin cola lineal fantasma en 3D) | UNKNOWN | packages/ui/src/preview3d/project3dPreview.ts:46 (indexed; verify) |
| F158 | #255 Producción: ficha de isla dibujada en Vistas y hojas de isla en PDF (no sólo lista de texto) | UNKNOWN | apps/web/src/exportProductionPack.ts:34 (indexed; verify) |
| F159 | #254 Producción: elevaciones e islas agrupadas por ambiente en Vistas y PDF (reabierto) | UNKNOWN | packages/ui/src/production/ProductionOrderViewsPanel.tsx:35 (indexed; verify) |
| F160 | #345 Bootstrap instalable y verificable de Granete for SketchUp | PARTIAL | apps/sketchup-extension/src/granete_for_sketchup.rb:12 (fragment) |
| F161 | #346 Semantic metadata y round-trip SketchUp ↔ Granete | UNKNOWN | apps/web/src/main.tsx:26 (indexed; verify) |
| F162 | #356 Parametric part relationships and joint-driven machining | UNKNOWN | backend-go/internal/domain/engine/layout.go:156 (indexed; verify) |
| F163 | #347 Milestone minimum authoritative preflight | UNKNOWN | backend-go/internal/api/authoring_resolve.go:357 (indexed; verify) |
| F164 | #349 Smart Parametric Furniture Library MVP | UNKNOWN | backend-go/internal/api/authoring_resolve.go:357 (indexed; verify) |
| F165 | #350 Sincronización de HardwarePlacement y mecanizado | UNKNOWN | packages/ui/src/preview3d/HardwarePlacementGizmo.tsx:12 (indexed; verify) |
| F166 | Login de taller, biblioteca remota y licencia en la extensión de SketchUp | UNKNOWN | packages/ui/src/users/users.css:1 (indexed; verify) |
| F167 | Inserción de muebles reales completos con elección de materiales en SketchUp | PARTIAL | apps/sketchup-extension/src/granete_for_sketchup/model/furniture_builder.rb:10 (fragment) |
| F168 | #347 Manufacturing preflight autoritativo — Definition of Done completo | UNKNOWN | backend-go/internal/api/authoring_resolve.go:357 (indexed; verify) |
| F169 | #325 Multi-org core — organizations, memberships, invitations, auditoría de seguridad y scoping del schema | UNKNOWN | apps/web/src/stores/workspaceStore.ts:672 (indexed; verify) |
| F170 | #325 Auth con contexto de organización — JWT v2, select-org, middleware OrgContext y scoping ruta por ruta | UNKNOWN | apps/web/src/stores/workspaceStore.ts:672 (indexed; verify) |
| F171 | #325 Tests de aislamiento cross-org y paridad de roles múltiples | UNKNOWN | apps/web/src/stores/workspaceStore.ts:672 (indexed; verify) |
| F172 | #326 Administración — consola de plataforma, equipo del taller, invitaciones auditables y sesión de soporte | UNKNOWN | apps/web/src/OrgPicker.tsx:1 (indexed; verify) |
| F173 | #327 Permisos de proyecto entre organizaciones — ownership comercial vs manufactura | PARTIAL | backend-go/internal/api/handlers.go:1432 (fragment) |
| F174 | Deployment VPS de producción + distribución del plugin SketchUp a talleres piloto | UNKNOWN | packages/domain/src/rbac.test.ts:537 (indexed; verify) |
| F175 | Hardening #325/#326/#327 — enforcement server-side de ownership, fail-closed org-less y redacción sales/manufactura | UNKNOWN | apps/web/src/ShellView.tsx:505 (indexed; verify) |
| F176 | Segunda ola de hardening multi-org — paridad RBAC, retiro del puente users.role y red de ventas de fábrica (#326) | UNKNOWN | apps/web/src/ShellView.tsx:505 (indexed; verify) |
| F177 | Cierre de deudas multi-org — DROP de users.role/license_* (000090) y pulidos UX | UNKNOWN | apps/web/src/stores/workspaceStore.ts:672 (indexed; verify) |
| F178 | Fixes del re-review de #325/#326/#327 — consola plataforma, CLI post-000090, gate de manufactura y regresiones FE | UNKNOWN | apps/web/src/ShellView.tsx:879 (indexed; verify) |
| F179 | Suite de Pilot Readiness multi-org — gate automatizado de coexistencia sin fuga de datos | UNKNOWN | apps/web/src/stores/workspaceStore.ts:672 (indexed; verify) |
| F180 | Política cero datos-demo en migraciones/arranque — seed explícito y pineado | UNKNOWN | backend-go/internal/storage/clean_demo.go:9 (indexed; verify) |
| F181 | cmd/admin clean-demo-data — limpieza segura del catálogo demo + seed no destructivo | UNKNOWN | backend-go/cmd/admin/main.go:387 (indexed; verify) |
| F182 | Aislamiento cross-org de las familias restantes + guardrails de reconciliación de issues | UNKNOWN | backend-go/db/migration/000091_org_scoped_stock_picking_pk.up.sql:6 (indexed; verify) |
| F183 | Espesor efectivo desde el MaterialBoard seleccionado en Go BOM y layout (#402 / MT-1) | UNKNOWN | backend-go/internal/domain/engine/effective_thickness.go:29 (indexed; verify) |
| F184 | Roles de binding de material canónicos: un solo rol por tablero + aliases legacy idénticos TS↔Go (#403 / MT-2) | UNKNOWN | packages/ui/src/preview3d/PartList.tsx:12 (indexed; verify) |
| F185 | Transform local→furniture autoritativo en el layout resuelto para ComponentInstances nativos de SketchUp (#414 / SU-ENT-1) | PARTIAL | apps/sketchup-extension/src/granete_for_sketchup/library/layout_contract.rb:1 (fragment) |
| F186 | Renderer nativo SketchUp: muebles y tableros como jerarquía de ComponentInstances (#415 / SU-ENT-2) | PARTIAL | apps/sketchup-extension/src/granete_for_sketchup/model/furniture_builder.rb:10 (fragment) |
| F187 | componentInstanceId único: contador global de copies por componente en la expansión de composición (#434) | UNKNOWN | backend-go/internal/domain/engine/layout.go:219 (indexed; verify) |
| F188 | Cambio de material: re-resolución y rebuild nativo atómico en SketchUp (#404 / MT-3) | UNKNOWN | backend-go/internal/domain/engine/layout.go:30 (indexed; verify) |
| F189 | Paridad TS ↔ Go ↔ SketchUp para espesor y propagación de materiales (#405 / MT-4) | UNKNOWN | backend-go/internal/domain/engine/material_role.go:35 (indexed; verify) |
| F190 | Validación real SketchUp nativo + interoperabilidad OpenCutList (#417 / SU-ENT-4) | UNKNOWN | backend-go/internal/domain/engine/layout.go:96 (indexed; verify) |
| F191 | Contrato OpenAPI generado, errores tipados, concurrencia e idempotencia (#448) | PARTIAL | contracts/openapi/granete-api.v1.yaml:1 (fragment) |
| F192 | Transacciones tenant-scoped y PostgreSQL RLS defense-in-depth (#449) | PARTIAL | backend-go/internal/storage/tenant_transaction.go:51 (fragment) |
| F193 | SelectionContext semántico y inspector contextual por capacidades (#476) | PARTIAL | apps/sketchup-extension/src/granete_for_sketchup/selection/selection_context.rb:34 (fragment) |
| F194 | Lifecycle explícito de identidad y membresía con onboarding invitation-first (#450) | PARTIAL | apps/web/src/SessionGate.tsx:49 (fragment) |
| F196 | Administración segura de Team, último admin y offboarding (#451) | PARTIAL | packages/ui/src/users/UsersScreen.tsx:281 (fragment) |
| F195 | Contrato versionado de resolve de autoría rica para mutaciones semánticas SketchUp (#477) | UNKNOWN | apps/web/src/main.tsx:26 (indexed; verify) |
| F197 | Lifecycle explícito y provisioning atómico de organizaciones (#452) | UNKNOWN | backend-go/db/migration/000101_remove_organization_active.up.sql:1 (indexed; verify) |
| F198 | Parámetros tipados definition-driven para rich authoring resolve (#483 / SU-API-2) | PARTIAL | backend-go/internal/domain/furniture_parameters.go:39 (fragment) |
| F199 | Tenant-safe Team, Organization and Platform UX (#458) | PARTIAL | apps/web/src/App.tsx:19 (fragment) |
| F200 | Paridad Go del tratamiento de base: ZOCLO-AUTO y effective base context (#442) | UNKNOWN | backend-go/internal/domain/engine/base_treatment.go:67 (indexed; verify) |
| F201 | Migración segura de entidades legacy Group a ComponentInstance nativo (#416 / SU-ENT-3) | UNKNOWN | backend-go/internal/domain/engine/layout.go:30 (indexed; verify) |
| F202 | Bounded revocable sessions, MFA, media authorization and auth hardening (#460) | PARTIAL | packages/ui/src/security/stepUp.tsx:84 (fragment) |
| F203 | Executable Foundation Gate A (#462) | UNKNOWN | apps/web/src/main.tsx:26 (indexed; verify) |
| F204 | Persist stable Project FurnitureInstance identity (#385 / DT-1) | PARTIAL | backend-go/internal/api/furniture_instances.go:24 (fragment) |
| F205 | Link QuoteLine quantities to physical FurnitureInstances (#386 / DT-2) | PARTIAL | backend-go/internal/api/quote_line_furniture_instances.go:57 (fragment) |
| F206 | Add Design aggregate and immutable DesignRevision snapshots (#387 / DT-3) | PARTIAL | backend-go/internal/storage/designs.go:78 (fragment) |
| F207 | Bind SketchUp models to Project/Design identity (#388 / DT-4) | PARTIAL | apps/sketchup-extension/src/granete_for_sketchup/connection/model_binding.rb:3 (fragment) |
| F208 | Project Furniture panel and place existing units in SketchUp (#389 / DT-5) | PARTIAL | apps/sketchup-extension/src/granete_for_sketchup/connection/project_furniture.rb:98 (fragment) |

## Evidence index and consumption
The JSON evidenceIndex maps IDs to current-snapshot file, line range, quoted excerpt, provenance and reviewLevel. Rows retain auditCrossReferences with explicit source-overlap caveats. Related PRs are linked only through an explicit feature ID or issue-closing relation in the captured PR body; this does not claim current remote checks or scope-equivalent completion.

## Required next verification
For every UNKNOWN row, use selected exact references before broad search. Confirm the feature-specific handler/component/function, trace its consumer/persistence and inspect the named test assertions. Then run the required layer-specific proof and attach its exact result. Do not use a broad suite pass for a physical host, machine readback, lifecycle or multi-tenant acceptance it does not cover.

## Key Learnings:
1. A source file mentioned in a general architecture document is not feature-specific implementation evidence.
2. Historical done, current source presence and executed acceptance are three distinct states.
3. A complete 204-row map must retain genuine unknowns rather than inventing verification.


## Second semantic pass — source 316df57c

20 additional features received manually read behavior, exact source excerpts and precise next proof. No new test execution. Audit depth remains independent of feature readiness.

### F004 — PARTIAL / semantic fragment

El writer produce A–J en orden fijo, rechaza lista vacía y agrega Referencias sin alterar la hoja Plantilla. generateCutRows itera solo boardParts, multiplica cantidades y ordena. Pruebas leídas comparan fixture y celdas tras reabrir con ExcelJS; no equivalen a apertura real Excel/LibreOffice.

Evidence: `packages/excel/src/optimizerExport.ts:84–161`, `packages/domain/src/engine/cut.ts:157–242`, `packages/excel/src/optimizerExport.test.ts:74–134`

Next proof: Descargar MOD-GAB-01 × 2, comparar A–J contra fixture y abrir en Excel/LibreOffice; registrar app/version y captura.

### F005 — PARTIAL / semantic fragment

workspace.ts es hoy barrel; JSONFileStorage es el adaptador real: ENOENT devuelve semilla, otros errores propagan; save escribe .tmp y rename. La prueba usa tempdir real y comprueba schemaVersion/no tmp remanente; no prueba carreras entre dos writers. No confundir este adaptador local con persistencia PostgreSQL actual.

Evidence: `packages/storage/src/workspace.ts:1–7`, `packages/storage/src/jsonFileStorage.ts:33–56`, `packages/storage/src/workspace.test.ts:47–78`

Next proof: Ejecutar round-trip tempdir y fallo antes de rename; verificar selección del adaptador en shell real. PostgreSQL se audita por separado.

### F014 — PARTIAL / semantic fragment

La semántica actual precomputa merma en calcMaterialCostPerM2; calcBoardLineCost multiplica área por costPerM2 y NO vuelve a multiplicar wastePercent. El test de 10% inyecta costPerM2=110. El criterio histórico de multiplicar merma al calcular cada línea está reemplazado por costo/m² ya ajustado; no aplicar otra vez.

Evidence: `packages/domain/src/engine/pricing.ts:54–64`, `packages/domain/src/engine/pricing.ts:109–114`, `packages/domain/src/engine.test.ts:437–466`

Next proof: Editar merma desde catálogo, guardar/reabrir y demostrar 1m²/100 precio/10% →110 en TS y Go sin doble aplicación.

### F015 — PARTIAL / semantic fragment

duplicateModule copia componentes/herrajes/agregados y genera nuevos ids de presets/herrajes. duplicateProject crea draft sin snapshot, nuevos ids de ítems y remapea placements. No se certifica clone completo de cada campo moderno: el objeto retornado enumera campos y requiere comparación contra tipos actuales.

Evidence: `packages/domain/src/duplicate.ts:131–164`, `packages/domain/src/duplicate.ts:179–210`, `packages/domain/src/duplicate.ts:239–256`

Next proof: Duplicar un mueble parametrizado y proyecto multiespacio; comparar configuración y referencias, editar copia y verificar original inmutable.

### F027 — PARTIAL / semantic fragment

Resolver de canto usa EDGE explícito primero y defaultEdgeBandId después; ambos verifican existencia/activo. Si no hay lados habilitados devuelve undefined. No hay match por nombre en esta ruta. No certifica aún UI crear-y-vincular ni FK/RLS.

Evidence: `packages/domain/src/engine/bom.ts:67–145`

Next proof: Prueba override válido/inactivo/inexistente y material con/sin FK; luego crear cintilla desde material y comprobar persistencia API.

### F028 — PARTIAL / semantic fragment

El BOM materializa grain con material.grainDefault ? 1 : 0 y cut row toma ese grain. Esto verifica la autoridad actual del material en la ruta TS, no la limpieza completa de campos legacy ni migración upgrade.

Evidence: `packages/domain/src/engine/bom.ts:290–317`, `packages/domain/src/engine/cut.ts:204–220`

Next proof: Cambiar grainDefault, resolver/exportar, comparar TS/Go; ejecutar fixture upgrade que contiene grain legacy y demostrar eliminación.

### F029 — PARTIAL / semantic fragment

effectiveOptionChoices copia defaults y sobreescribe solo valores no vacíos del ítem; espacios/blancos heredan. La ruta de cut rows pasa esa mezcla al BOM. Tests leídos cubren default, override y blancos; persistencia/routed API no verificada aquí.

Evidence: `packages/domain/src/optionChoices.ts:12–29`, `packages/domain/src/optionChoices.test.ts:7–37`, `packages/domain/src/engine/cut.ts:157–165`

Next proof: Dos ítems, default A y override B: guardar/reabrir y comparar precio, snapshot y export en UI/API real.

### F030 — PARTIAL / semantic fragment

Pipeline XLSX rechaza proyecto vacío; precio congelado viene de priceSnapshot.breakdown si cerrado y con snapshot, resto pasa por calcProjectBreakdown. Labels/nombres de módulos/opciones se resuelven del catálogo actual, no snapshot. XLSX incluye costos internos por diseño del contrato F030; no confundir con PDF comercial sale-only.

Evidence: `apps/web/src/exportCommercialQuote.ts:98–155`

Next proof: Exportar draft y accepted; modificar catálogo después de aceptar y comprobar qué nombres/precios se mantienen; abrir XLSX y revisar audiencia.

### F045 — PARTIAL / semantic fragment

Pipeline PDF usa breakdown congelado cuando existe y pasa únicamente salePrice al writer, sin costos internos. Opciones/nombres se resuelven del catálogo actual. No demuestra layout final ni ausencia de otros datos sensibles en bytes PDF.

Evidence: `apps/web/src/exportCommercialQuotePdf.ts:124–158`

Next proof: Descargar ambas variantes del PDF de un accepted, extraer texto y revisar visualmente que solo muestra venta y datos esperados.

### F046 — PARTIAL / semantic fragment

formatEdgeBandingInstruction deriva lados habilitados en orden L1/L2/W1/W2; devuelve Sin encintar o instrucción con material/espesor/código. generatePieceLabels valida cantidad/módulo antes de resolver; etiquetado físico/impresión y gate por estado siguen sin ejecutar.

Evidence: `packages/domain/src/engine/cut.ts:269–300`, `packages/domain/src/engine/cut.ts:315–344`

Next proof: Resolver pieza con cuatro lados distintos, verificar etiqueta final/QR y gate accepted/produced desde rol producción.

### F047 — PARTIAL / semantic fragment

Resumen agrupa por material.id y edge.id, acumula métricas calculadas por calcBoardLineCost con qty de ítem; usa mismo BOM con opciones efectivas, preset, pin, base y customDims. Hardware se delega a generateHardwareList; revisión limitada al agregado de materiales/cantos.

Evidence: `packages/domain/src/engine/labels.ts:83–169`

Next proof: Proyecto con dos materiales y cantidades >1: comparar resumen m²/ml contra sumatoria BOM y UI/PDF tras reload.

### F048 — PARTIAL / semantic fragment

Descripción de pieza concatena código de pieza opcional, nombre y código de módulo; hoja principal sigue 10 columnas, referencias viven en hoja separada. Esto es trazabilidad humana, no identidad productiva FurnitureInstance.

Evidence: `packages/domain/src/engine/cut.ts:52–64`, `packages/excel/src/optimizerExport.ts:124–161`

Next proof: Comparar A–J y Referencias para mismo módulo repetido con códigos de pieza iguales; verificar referencias legibles y no ambiguas.

### F051 — PARTIAL / semantic fragment

resolveModuleMeasurePreset exige preset cuando hay lista, rechaza id ajeno y dimensiones <=0; validateModulePresets rechaza ids vacíos/duplicados. Sin presets permite ruta fixed/default y rechaza selección espuria. Falta probar integración editor/precio/snapshot.

Evidence: `packages/domain/src/measurePresets.ts:18–70`, `packages/domain/src/measurePresets.ts:136–169`

Next proof: Misma estructura con dos anchos debe producir precio/despiece diferente; guardar preset inválido debe ser rechazado en UI y API.

### F055 — PARTIAL / semantic fragment

pickPresetByMeasureDefaults usa tipo de mueble (fallback inferior), minimiza distancia absoluta mm en fondo/alto y conserva primer preset en empate. Sin defaults usa primero; sin presets undefined. Selección es sugerencia al agregar, no mutación de ítems ya elegidos.

Evidence: `packages/domain/src/measurePresets.ts:90–133`

Next proof: Agregar muebles inferior/superior/alto con defaults, override por línea y reload; comparar backend y snapshot.

### F056 — PARTIAL / semantic fragment

Plantillas separan customer/status/snapshot y crean nuevos ítems draft con remap de placements; sin embargo ambas conversiones reconstruyen kitchenLayout solo walls/placements y omiten spaces/base/cubierta. Difiere del clone completo prometido para el modelo multiespacio moderno. Defecto de fuente, no reproducción runtime.

Evidence: `packages/domain/src/duplicate.ts:274–313`, `packages/domain/src/duplicate.ts:333–380`

Next proof: Guardar como plantilla proyecto con dos spaces, baseClearanceMm y cubierta; crear proyecto/reload y comparar todos los campos de layout. Prueba negativa debe detectar omisiones.

### F060 — PARTIAL / semantic fragment

engine.ts es barrel de 10 líneas hacia engine/index; index exporta responsabilidades validate/bom/pricing/cut/labels. La descomposición actual satisface el aspecto estructural, pero compatibilidad exacta con API histórica y todos los tests no se deducen de la estructura.

Evidence: `packages/domain/src/engine.ts:1–10`, `packages/domain/src/engine/index.ts:16–53`

Next proof: Comparar exports públicos con contrato esperado y ejecutar suites golden sin modificar asserts; no usar número de archivos como proof.

### F082 — PARTIAL / semantic fragment

calculateAgregadoSubspaceUnits reparte alto/ancho restando (N−1)*gap y posiciona cada unidad; resolveAgregadoInstance multiplica cantidades, refleja placement/rotación y evita doble conteo de herraje bulk cuando hay posicionados. El nombre del helper que calcula offsets difiere del criterio histórico; integración de fórmulas locales pendiente.

Evidence: `packages/domain/src/agregados.ts:63–136`, `packages/domain/src/agregados.ts:152–205`

Next proof: Resolver tres cajones verticales con gap y puertas espejadas, comparar bounding boxes locales, BOM, herrajes y poses TS/Go.

### F183 — PARTIAL / semantic fragment

effectiveThicknessMm resuelve choice activo antes de fórmula: material desconocido/inactivo/error espesor<=0 falla; solo choice ausente permite nominal. BOM y layout llaman esa función antes de construir contextos T. Esta lectura verifica autoridad de espesor en ambas rutas Go, no TestUp.

Evidence: `backend-go/internal/domain/engine/effective_thickness.go:31–67`, `backend-go/internal/domain/engine/resolve.go:441–475`, `backend-go/internal/domain/engine/layout.go:511–532`

Next proof: Ejecutar regression_402_test con nominal15/18 y BODY16 FRONT18 BACK6, comparar BOM/layout; endpoint 422 para selección inválida.

### F184 — PARTIAL / semantic fragment

TS y Go normalizan roles (trim, sin vacíos/duplicados), exigen exactamente uno y aplican tabla legacy FRENTE explícita. Tests leídos cargan mismo JSON y comparan aliases/bindings positivos/negativos. Revisión no valida todos los consumidores UI ni enforcement POST/PUT.

Evidence: `packages/domain/src/materialRole.ts:34–102`, `backend-go/internal/domain/engine/material_role.go:37–105`, `packages/domain/src/materialRoleBinding.test.ts:61–98`, `backend-go/internal/domain/engine/regression_403_test.go:48–99`

Next proof: Ejecutar ambos tests contractuales y POST/PUT de roles ambiguos; revisar que editor no permita guardar selección múltiple.

### F187 — PARTIAL / semantic fragment

Contador por component.id vive fuera del loop de entradas en TS/Go y se incrementa por copia; el índice i local permanece para fórmulas espaciales. La identidad deja de reiniciarse por entrada dentro de esa expansión; no prueba colisión entre diferentes scopes ni real-host metadata.

Evidence: `packages/domain/src/engine/bom.ts:390–418`, `packages/domain/src/engine/bom.ts:456–465`, `backend-go/internal/domain/engine/layout.go:495–505`, `backend-go/internal/domain/engine/layout.go:605–612`

Next proof: Ejecutar escenario qty1+2 mismo componente: ids copy0/1/2 únicos y definition compartida; comparar golden sin duplicados y metadata real-host.

Remaining source-index-only candidates: **120**. Semantic fragments: **84**. COMPLETE: **0**. Every original acceptance item retains its unexecuted status.

## Third semantic pass: exports, desktop, CNC and infrastructure

### F001
Monorepo usa workspaces packages/* y apps/*, scripts recursivos pnpm y packageManager 11.1.2. Incluye OpenAPI/gates además del scaffold histórico. No se deduce aislamiento arquitectónico por estructura de carpetas.

Evidence: `package.json:1–26`, `pnpm-workspace.yaml:1–7`

Next proof: Verificar imports/boundaries por paquete y builds de cada shell; scaffold existente no demuestra feature de negocio.

### F010
buildOptimizerExport bloquea issues antes de generar, convierte DomainError a issues; deliverExcelFile espera diálogo/escritura Electron y distingue cancelled, frente a descarga web. UI gate por estado/permisos debe probarse aparte.

Evidence: `apps/web/src/exportOptimizer.ts:42–76`, `apps/web/src/exportOptimizer.ts:138–150`

Next proof: Forzar falta de opción y verificar lista accionable; descargar Web, cancelar/guardar Electron y comparar bytes.

### F011
createSeedWorkspace produce esquema3, catálogo ampliado, dos proyectos y plantilla; escena performance solo por flag local explícito. No es seed productivo de migración Go. Test writer usa fixture MOD-GAB, sin prueba de toda equivalencia Excel original.

Evidence: `packages/storage/src/seed.ts:29–67`, `packages/excel/src/optimizerExport.test.ts:93–106`

Next proof: Abrir workspace nuevo invitado y cotejar precio contra plantilla fuente; jamás inferir datos empresariales de seed.

### F019
Toasts actuales pertenecen a uiStore, no ToastProvider histórico: descartan mensaje vacío, deduplican tipo/mensaje y renuevan lifetime. Cola limita visibles a3, salida programada. A11y y feedback persistente no se prueban por este store.

Evidence: `apps/web/src/stores/uiStore.ts:192–253`

Next proof: Disparar duplicados, overflow y cierre manual; lector pantalla anuncia error y no confundir toast transitorio con audit durable.

### F032
Host real BrowserWindow carga Vite dev o web/dist, con contextIsolation/sandbox y nodeIntegration false. IPC implementa save dialog y escritura. No es solo fábrica TS; instalador/arranque real no ejecutados.

Evidence: `apps/desktop/electron/main.mjs:205–222`, `apps/desktop/electron/main.mjs:269–277`, `apps/desktop/electron/main.mjs:283–334`

Next proof: Lanzar empaquetado en perfil limpio contra backend de prueba y exportar Excel con diálogo real.

### F059
EntityEditorLayout distingue modal, inline editor y detalle; footer submit usa formId y descartar requiere confirmación. Reutiliza Modal y callbacks del dueño; no impone por sí mismo persistencia exitosa ni dirty tracking.

Evidence: `packages/ui/src/common/EntityEditorLayout.tsx:100–156`, `packages/ui/src/common/EntityEditorLayout.tsx:158–200`

Next proof: En cada consumidor editar/cancelar/navegar y probar focus trap, retorno de foco y pérdida de cambios; fallo API debe conservar draft.

### F061
CommandManager mantiene undo/redo, aplica comando antes de apilar, elimina redo al nuevo execute y límite default50; clear limpia ambas pilas. No guarda en backend: integración transaccional y atajos son otro proof.

Evidence: `packages/domain/src/commandManager.ts:15–103`

Next proof: Secuencia add/update/remove/undo/redo y nuevo comando tras undo; verificar guardar/reload y cambio de tenant/proyecto limpia historia.

### F064
uiStore es slice independiente con export errors/busy y create keys; toast tiene mapas de timers, dedupe y estados enter/visible/exit. La separación de estado está presente; no demuestra cobertura de todos los callers ni limpieza tenant.

Evidence: `apps/web/src/stores/uiStore.ts:85–114`, `apps/web/src/stores/uiStore.ts:192–253`

Next proof: Dos exports simultáneos y dispose; verificar busy no se desactiva prematuramente ni quedan timers luego de logout.

### F071
Generador real vive en domain/zplLabels y excel reexporta. Usa tres tamaños, DPI203/300, ^BQ QR, datos de revisión y representación distinta por tamaño. IPC raw-print existe; no se certifica calibración ni escaneo físico Zebra.

Evidence: `packages/domain/src/zplLabels.ts:18–59`, `packages/domain/src/zplLabels.ts:76–118`, `packages/domain/src/zplLabels.ts:149–179`, `apps/desktop/electron/main.mjs:337–346`

Next proof: Imprimir los tres presets en impresora/modelo/DPI exactos, medir escala y escanear QR; probar cancelación/fallo spooler.

### F073
API actual admite delimiter/header/preset/materialFilter con headers predefinidos; no columnas libres/reorder/encoding. Modal mantiene esas cuatro opciones en estado local y descarga UTF8; no hay guardado por taller en este componente. Es subset del criterio histórico, no COMPLETE.

Evidence: `packages/domain/src/cutListConfigurableCsv.ts:10–46`, `packages/domain/src/cutListConfigurableCsv.ts:125–167`, `packages/ui/src/production/CsvExportConfigModal.tsx:33–80`

Next proof: Verificar especificación comercial vigente: si exige columnas libres y Latin1, implementar aparte; probar archivo en software exacto, no asumir por nombre preset.

### F074
Ruta histórica F074 es heurística por nombre: puerta/door produce dos tazas35mm/12.5mm. Resolver moderno prioriza perfiles pero fallback vuelve a esta función cuando no obtiene holes. No prueba que Component.perforations fluya a BOM/CSV/ZPL como criterio original.

Evidence: `packages/domain/src/partDrilling.ts:66–95`, `packages/domain/src/partDrillingResolver.ts:515–545`

Next proof: Renombrar misma pieza sin herrajes no debe alterar producción certificada; separar preview heurístico y rechazar export autoritativo sin perfil.

### F075
Config electron-builder define NSIS/portable Windows, dmg/zip macOS y releasesGitHub; main activa autoUpdater solo fuera de dev, descarga e instala al salir. build:desktop llama package --dir, no el target dist instalador pedido. Certificado/firma Windows y smoke permanecen UNKNOWN.

Evidence: `apps/desktop/package.json:10–28`, `apps/desktop/electron/main.mjs:53–79`, `package.json:10–15`

Next proof: Ejecutar dist:win con certificado autorizado y verificar firma/instalación Win10/11, update firmado, backend y export.

### F124
MaxRects usa rectángulos libres, recorta espacios y selecciona remanentes disjuntos; evalúa rotación solo sin veta y config permitida. Es nesting rectangular, no toolpath ni programación máquina.

Evidence: `packages/domain/src/optimizer/nesting.ts:47–97`, `packages/domain/src/optimizer/nesting.ts:150–199`

Next proof: Fixtures no-overlap, clearance, trim/veta/rotación y densidad; readback CAM independiente antes de maquinaria.

### F125
DXF dibuja polilínea por pieza, etiquetas/veta, y holes opcionales según cara; holes solo bajo !p.rotated. Ese alcance no satisface drilling de pieza rotada (defecto ya reproducido por root), aunque geometría de contorno sí se genera.

Evidence: `packages/excel/src/dxfCutPlanExport.ts:213–264`

Next proof: Leer DXF en parser y software objetivo: mismas perforaciones con pieza normal/rotada y caras espejo; cotejar profundidad por mapping autorizado.

### F127
validateMachiningProfile exige parts, ids/roles únicos y operaciones; normalize es tolerante y elimina roles/operaciones inválidas, pudiendo devolver undefined. Validación de autoría no equivale a certificación técnica del hardware ni a fail-closed de todos los readers.

Evidence: `packages/domain/src/hardwareMachining.ts:146–209`, `packages/domain/src/hardwareMachining.ts:262–292`

Next proof: Perfil multi-parte válido/erróneo en save y reload; demostrar que normalización no borra silenciosamente operación necesaria antes de export.

### F128
Resolver transforma offsets por giroZ, elige cara/opposite y depth through de espesor; valida límites/profundidad y genera issues. strict default false; fallos de fórmula usan coordenada numérica y ausencia de holes cae a heurística. Por ello motor existente no implica preflight fail-closed.

Evidence: `packages/domain/src/partDrillingResolver.ts:419–470`, `packages/domain/src/partDrillingResolver.ts:474–545`, `packages/domain/src/partDrillingResolver.ts:228–291`

Next proof: Pruebas límite/profundidad/collision + fórmula inválida y missingprofile; verificar cómo caller presenta/bloquea cada issue.

### F129
Reglas derivan placements por componentPlacement, defaults32mm y códigos de herraje. Back panel genera through pilot específico; bisagras/tapas se derivan por alto. Código inexistente devuelve undefined y omite grupo; esto no es búsqueda de contacto geométrico arbitrario ni certificación de herraje.

Evidence: `packages/domain/src/jointDrillingRules.ts:89–109`, `packages/domain/src/jointDrillingRules.ts:274–318`, `packages/domain/src/jointDrillingRules.ts:379–403`

Next proof: Caja con contactos válidos/inválidos, catálogos sin código y puertas con diferentes alturas: comprobar parejas, offsets y diagnóstico explícito.

### F130
Project drilling conserva fallback/issues en patterns internos pero los elimina en data.patterns; handler DXF usa ese data y omite drilling completo si resolver lanza error, aun emitiendo success. DrawPiece omite holes al rotar. Son límites confirmados fuente y vinculados a proofs existentes, no falta total de export.

Evidence: `packages/domain/src/projectDrilling.ts:176–212`, `apps/web/src/exports/useExportHandlers.ts:433–453`, `packages/excel/src/dxfCutPlanExport.ts:238–264`

Next proof: Repetir proofs audit de fallback/rotación y validar bloqueo por issue; comparar salida CAM exacta sin llamar CNC-compatible al DXF.

Current semantic rows: 102; source-index-only: 102; COMPLETE0.

## Fourth pass: remaining early product scopes

### F016
Tokens tipográficos, marca y áreas están definidos en CSS; comentarios de contraste son claims de fuente, no medición de cada pantalla. Foco, tamaños táctiles y contraste efectivo requieren styles computados reales.

Evidence: `packages/ui/src/design-system/tokens.css:6–79`

Next proof: Medir contraste/foco/tamaño a1280/768/390 en pantallas relevantes, sin asumir token garantiza todo.

### F017
AppShell controla apertura sidebar, la cierra al navegar y expone nav semántica con aria-current; admite anchors reales o botones según hrefForNav. Revisión no prueba navegación de cada rol ni mobile trap.

Evidence: `packages/ui/src/shell/AppShell.tsx:577–582`, `packages/ui/src/shell/AppShell.tsx:648–664`, `packages/ui/src/shell/AppShell.tsx:718–737`

Next proof: Navegar teclado y touch, back/forward y copy-link; verificar menú responsive y destino autorizado.

### F025
Categorías usan parentId, traversal con detección de ciclo en categoryDepth, máximo configurado 3 y orden sortOrder/nombre. Helpers UI aplanan jerarquía. Enforcement server/guardado y ciclo en todos los recorridos no quedan probados.

Evidence: `packages/domain/src/categories.ts:27–87`, `packages/ui/src/modules/helpers/moduleCategoryTree.ts:34–46`

Next proof: Crear niveles 1/2/3 y rechazar 4/ciclo por API y UI; mover/borrar categoría con dependientes sin orphans.

### F033
nextGridEnterTarget mantiene campo y avanza a siguiente rowId; última fila devuelve addRow. Es helper vivo de navegación, no demuestra teclado enter conectado a todos los grids modernos.

Evidence: `packages/ui/src/modules/helpers/moduleGridNavigation.ts:8–24`

Next proof: En editor real Enter en qty/length/width avanza y crea fila; probar readonly/error y no enviar formulario accidental.

### F037
SalesDashboard filtra por owner si vendedorId efectivo, espera projects ya filtrados por caller. Métricas mensuales del fragmento usan mes de creación y priceSnapshot, no evento de cobro ni cierre real. No prueba aislamiento por esconder filas.

Evidence: `packages/ui/src/sales/SalesDashboard.tsx:51–86`, `packages/ui/src/sales/SalesDashboard.tsx:115–143`

Next proof: Vendedor A/B + gerente con API real; validar cohortes versus eventos y diferenciar valor cotizado de ingreso.

### F039
roleCanViewCosts niega vendedor/user salvo flag true; guest/null permite costos y roles taller selectos permiten. Esta función pura no prueba redacción de respuestas API ni datos ocultos en memoria.

Evidence: `packages/domain/src/rbac.ts:480–505`

Next proof: Inspeccionar payloads API con vendedor sin flag, no solo CSS; verificar export/resumen tampoco filtran costos.

### F040
CatalogImage muestra img lazy con alt y placeholder visual aria-hidden; vitrina filtra categoría y búsqueda. Fotos no generadas por feature; seed sin foto observado por root no es imagen rota del renderer.

Evidence: `packages/ui/src/common/CatalogImage.tsx:36–69`, `packages/ui/src/modules/ModuleShowcase.tsx:58–98`

Next proof: Cargar fotos reales, URL caducada/no existente y empty catálogo; confirmar fallback y CTA cotizar con nombre correcto.

### F041
Gate TS producción combina rol habilitado con status accepted/produced; almacén y vendedor ausentes. No certifica revisión Design exacta ni backend por este helper histórico.

Evidence: `packages/domain/src/rbac.ts:184–214`

Next proof: Ingeniero accepted export y draft denial, vendedor/almacén denial; además preflight/release exactos actuales.

### F042
uploadCatalogImage requiere token, POST FormData a /media y espera response/url; resolveMediaUrl usa grants compartidos. Roles/MIME/límites del servidor son capas separadas; API defect MIME ya documentado en backend.

Evidence: `apps/web/src/stores/catalog/media.ts:14–43`

Next proof: Ingeniero/admin upload y vendedor 403, MIME falso y archivo grande, reemplazo y grant tenant-switch; no JWT en query.

### F043
Vitrina tiene búsqueda debounced y filtros jerárquicos con conteos; openDetail fija detalle y llama onSelect. API no transporta BOM en este componente. Home por rol no inferido del fragmento vitrina.

Evidence: `packages/ui/src/modules/ModuleShowcase.tsx:58–103`

Next proof: Abrir vitrina por vendedor y cotizar desde detalle; verificar home por rol y catálogo sin imágenes.

### F044
Excepción de costos es boolean explícito vendedorCanViewCosts===true; default false para vendedor/user. Habilitación server por organización y persistencia settings no se deducen del helper.

Evidence: `packages/domain/src/rbac.ts:480–505`

Next proof: Cambiar setting como admin, reload y payload vendedor; scope debe quedar en taller actual sin filtrar otro tenant.

### F049
Modelo actual estructura compone ComponentInstances; resolveStructure ya solo valida dimensiones positivas y devuelve[]; expansión ocurre en resolveComposedModule para estructuras y módulos. Criterio histórico de boardParts directos fue reemplazado, no debe restaurarse.

Evidence: `packages/domain/src/engine/bom.ts:546–594`, `packages/domain/src/engine/bom.ts:947–968`

Next proof: Crear estructura de componentes, reutilizar en dos muebles con dimensiones distintas y revision pin; comparar BOM y persistencia.

### F065
Ítem sin colocar expone drag solo canEdit; payload incluye itemId/instanceIndex y dimensiones, activa ghost. Escena renderiza GhostModuleMesh con posición y valid. No se ejecutó aquí raycast/snap/drop/colisión; root tiene pruebas guest separadas.

Evidence: `packages/ui/src/projects/components/ProjectSpatialStudio.tsx:3524–3568`, `packages/ui/src/preview3d/FurnitureScene3D.tsx:2488–2497`

Next proof: Drag real a muro y piso, colisión rechazo, Escape cancelación y undo; repetir viewport 768/390 por falla canvas conocida.

### F066
Inspector secciones colapsables tiene aria-expanded/controls y panel region identificado; vacío guía a selección. Campos hardware aceptan callback opcional, por lo que inputs visibles no prueban edición conectada.

Evidence: `packages/ui/src/preview3d/PartInspector.tsx:74–111`, `packages/ui/src/preview3d/PartInspector.tsx:140–159`

Next proof: Teclado abre/cierra secciones, persist session, selección de pieza; comprobar callbacks/mutación antes de demostrar authoring.

### F067
Paleta actual trabaja AmbientMaterial, arrastra materialId+surfaceType en MIME específico. No aplica por click; esto es ambientación, no MaterialBoard cotizable. Aplicación drop/raycast requiere consumidor y proof separado F142.

Evidence: `packages/ui/src/preview3d/MaterialPalette.tsx:69–104`

Next proof: Arrastrar muro/piso/cubierta, comprobar tipo rechazado y undo; ofrecer alternativa teclado si requiere accesibilidad.

### F068
HardwareMesh posee ramas para knob/bar/cup/hinge/slide/rail/leg con primitivas proporcionales; hinge/slide usan boxes/cylinders y fallback dimensional. Son previews genéricos, no CAD de fabricante ni compatibilidad mecanizado.

Evidence: `packages/ui/src/preview3d/HardwareMesh.tsx:150–170`, `packages/ui/src/preview3d/HardwareMesh.tsx:350–395`, `packages/ui/src/preview3d/HardwareMesh.tsx:500–515`

Next proof: CapturasWebGL por shape y pose en 6 caras; contrastar dimensión comercial sin afirmar piezaCADcertificada.

### F069
Acabados se implementan como cinco presets en hardwareFinishes.ts y matchingPBR tolerante; no tabla hardware_finishes ni selector necesariamente en inspector como criterio viejo. Equivalencia debe ser decisión explícita, no cumplimiento literal.

Evidence: `packages/domain/src/hardwareFinishes.ts:14–71`, `packages/domain/src/hardwareFinishes.ts:90–119`

Next proof: Guardarpreset desde catálogo, reload y compararPBR; documentar scope sin tabla ni inspector si ese requisito fue sustituido.

### F070
Furniture3DViewer monta PartInspector sin placements/onUpdateHardwarePlacement/hardwareCatalog. En esa superficie los callbacks del inspector no están conectados; no afirmar gizmo profesional porque existe helper. Editor de catálogo puede tener otra ruta independiente.

Evidence: `packages/ui/src/common/Furniture3DViewer.tsx:442–449`, `packages/ui/src/preview3d/PartInspector.tsx:24–35`

Next proof: En visor seleccionado moverherrajes y verificar cambio real/persistencia/undo; inspeccionar otro caller antes de extrapolar a todoslos editores.

### F072
Empaquetador legacy desdobla qty, recorre filas/tableros, pero Math.min recorta pieza mayor al área útil sin error. cutPreviewPdfExport lo llama y packproducción adjunta PDF best-effort. No confundir previewcon motor guillotinaF115 ni confiar como plan físico.

Evidence: `packages/excel/src/cutPreviewPdfExport.ts:69–128`, `packages/excel/src/cutPreviewPdfExport.ts:134–147`, `apps/web/src/exportProductionPack.ts:177–188`

Next proof: Pieza3000x500 en2440x1830: comparar dimensiones reales y rectánguloPDF, debe rechazar oversized o indicarlo, sin enviar corte.

### F076
Tour tres pasos y CTA demo, dismiss/skip guarda hasSeen local; sin storage tolera error. Marketing menciona producción1clic y mecanizado, por eso debe acotarse por gates reales. No prueba onboarding organization invitation.

Evidence: `packages/ui/src/onboarding/OnboardingTourModal.tsx:19–40`, `packages/ui/src/onboarding/OnboardingTourModal.tsx:51–113`

Next proof: First-run invitado, skip/reload y CTA demo; usuario nuevo organization debe seguir invitación, no autoaprobar.

### F077
Ledger marca pending, pricing40/80 solo sugerido; roadmap pide pricing validado/landing/script. No se encontraron archivos pricing.md/demo-script.md en búsqueda dedicada docs. Scope comercial revisado, evidencia externa de venta/landing sigueUNKNOWN.

Evidence: `feature_list.json:1488–1505`, `docs/roadmap-comercial-v2.md:364–375`

Next proof: Solicitar/identificar landing y pricing aprobados reales; cotejar claims contra producto sin inventar tarifas.

### F078
Ledger congelado describe naming-based export, pero roadmap activa programaSketchUp y prohíbe trasladar BOM/drilling aRuby; actual programa usa identidad contractual, no naming. F078 histórico está supersedido en intención, no pendiente para implementar literalmente.

Evidence: `feature_list.json:1508–1519`, `docs/roadmap-comercial-v2.md:390–405`

Next proof: Usar programa#465/DT y contrato actual; verificar host firmado/identidad exacta; no crear parser productivo por nombres.

### F079
Ledger exige demanda probada antes de pipeline Blender y sigue pending; roadmap conserva render premium condicionado. No se evaluó render Cycles como capacidad existente porque no está autorizado como implemented.

Evidence: `feature_list.json:1522–1533`, `docs/roadmap-comercial-v2.md:379–388`

Next proof: Confirmar demanda/alcance, prototipo benchmark y costes antes de prometer render backend; no contar preview WebGL como Blender.

### F080
Material por parte resuelve body/base/grip y renderer conecta body/base a submeshes. Presets 5 vienen de dominio; no acabados arbitrarios ilimitados ni garantía material-fabricación.

Evidence: `packages/ui/src/preview3d/HardwareMesh.tsx:244–275`, `packages/domain/src/hardwareFinishes.ts:14–71`

Next proof: Cambiar body/base/grip desde catálogo, reload y comparar bar pull/hinge; probar límites por shape.

### F081
Objetivo CSG booleana fue sustituido por holes estructurados: resolver emite HoleDefinition con face/coords/diam/depth y export DXF consume. No mesh perforada ni Gcode genérico; faltas F128/F130 limitan manufactura.

Evidence: `packages/domain/src/partDrillingResolver.ts:474–508`, `packages/excel/src/dxfCutPlanExport.ts:238–264`

Next proof: Mantener datos/hardware como authority; validar perfiles/negativos/readback, no introducir CSG para simular cadena cerrada.

### F086
Ambient API lectura/escritura usa entidad sin pricing, mutación RoleCanMutateCatalog, conflicto 409 y activa POST. Helpers categoría genéricos hasta 3 niveles. Navegación Acabados y selección por superficie se verifican aparte del handler.

Evidence: `backend-go/internal/api/ambient.go:19–46`, `packages/domain/src/categories.ts:27–87`

Next proof: Crear árbol de 3 niveles y material ambiental, reload, editar/borrar, denegar rol y asegurar no BOM/costo.

### F087
applyBaseTreatment agrega ZOCLO-AUTO solo en plinth_board con altura/ancho>0 y sin rol ZOCLO propio; patas solo con choice PATAS; evita duplicación. Modelo real combina contexto/plinthrun y herraje, no solo geometría decorativa.

Evidence: `packages/domain/src/plinth.ts:515–564`

Next proof: Comparar none/legs/plinthboard/strip en BOM/3D/precio y selección ausente; contracts Go F200 independientes.

### F088
Exposición lateral por vecinos en misma pared y tolerancia 30; freeplacement expone left/right/back. Generador añade vueltas con depth/altura y rol ZOCLO; no prueba lógica física universal para paredes curvas/esquinas.

Evidence: `packages/domain/src/plinth.ts:268–304`, `packages/domain/src/plinth.ts:524–540`

Next proof: Módulos adyacentes/borde/isla y gap29/31mm; comparar vueltas 3D/BOM/materialthickness.

### F089
Floor-scan resuelve item/factory/modulecode; si línea tiene ModuleUnits devuelve 409 para forzar QR físico. Ya no debe demostrarse solo pipeline legacy por línea. Auth/scope de scanner necesita router+DB.

Evidence: `backend-go/internal/api/floorScan.go:117–154`

Next proof: Escanear piece/unit y repetición, QR legacy en línea física 409; sector rechazado y stale revision.

### F090
Métricas de período usan createdAt como cohort y avgDaysToClose usa snapshot capturedAt proxy. Funnel tasa quoted+won excluye drafts; falta snapshot aporta 0 al pipeline. No confundir con ingresos/cierre real ni garantía costo real.

Evidence: `packages/domain/src/metrics/workshopMetrics.ts:124–185`

Next proof: Fixture eventos creación/cotización/aceptación/reapertura distintos; UI debe etiquetar proxy/missing, no reportar cierre exacto.

### F091
Mobile escucha initialURL/eventos y unwrapQR, navega scanner/processScan. Target distingue partInstance/moduleUnit y legacy; network failure enqueue y warning, no success. No se ejecutó device/cámara/offline-retry real.

Evidence: `apps/mobile/App.tsx:64–90`, `apps/mobile/src/stores/floorScannerStore.ts:77–105`, `apps/mobile/src/stores/floorScannerStore.ts:295–325`

Next proof: Device real cold/warm deeplink y sesión expirada, offline→reconnect sin doble avance ni cross-tenant queue.

### F092
Sectors mantienen mapping legacy cut/edged/assembled/packaged/loaded/installed y CNC null; buildProjectFloorSummary salta a physical cuando hay parts+units. CNC pieza existe fuera de mapping legacy; no inferir missing CNC global.

Evidence: `packages/domain/src/productionSectors.ts:82–128`, `packages/domain/src/productionSectors.ts:168–173`

Next proof: Comparar contador piezas Cut/CNC/Edge y unidades Assembly con qty>1, eventos dobles y fallback legacy.

### F094
Claim exige AnyRole RoleCanClaimProductionJob y verifica sector cuando todos roles scoped. No usa solo export para Claim. Roles export excluyen almacén. No prueba finish/damage ni race exclusividad por esta lectura.

Evidence: `backend-go/internal/api/productionActivity.go:76–113`, `packages/domain/src/rbac.ts:184–196`

Next proof: Operador sector A rechaza B; multirole union, claim/finish/damage y manager read; probar router+DB tenant.

### F095
Claim permite itemId vacío project×station; duplicado se verifica por mismo operator/project/item, no bloquea otros operadores. Comentario inicial locked no describe exclusividad real. Race concurrente requiere DB constraint proof.

Evidence: `backend-go/internal/api/productionActivity.go:115–154`

Next proof: Dos operadores pueden claim misma obra; mismo operador duplicado 409 incluyendo race; totales pieces/sides verificar aparte.

### F099
FabricScreen diferencia sin sectores, nada pendiente y tab vacío; WorkflowTabs con tabpanel/label y callbacks físicos separados. No prueba calidad responsive/a11y completa por usar primitivas.

Evidence: `packages/ui/src/production/FabricScreen.tsx:759–815`

Next proof: Real role/real data y error 500, teclado/foco y 390/768; no empty en error ni CTA sin permiso.

Current semantic rows: 137; source-index-only: 67; COMPLETE0. UNKNOWN may be a reviewed future scope, not an unread candidate.

## Integrated delegated semantic reviews

The 39 UI fragments and 28 later-ledger fragments were integrated with exact excerpt validation against the pinned source. Full details: `feature-fragments-ui.md`, `feature-fragments-extra.md`; normalized evidence is embedded in the matrix. No runtime tests were executed by these readers.

## Scoped findings from semantic review

No new runtime reproduction is claimed.

### FM-01 — Project templates omit modern layout fields

projectToTemplate and createProjectFromTemplate copy walls and placements only; duplicateProject separately preserves spaces, clearance and countertop settings. The real store persists these template conversions.

Expected: A reusable layout template should preserve supported design configuration or explicitly disclose excluded fields.

Impact: Reusing a multi-space design may lose its spatial/configuration context; impact inferred from conversion, not reproduced.

Action: Preserve the supported layout contract through template conversion and add save/create/reload comparison with multiple spaces and custom countertop/clearance.

Evidence: packages/domain/src/duplicate.ts:204-235, packages/domain/src/duplicate.ts:274-313, packages/domain/src/duplicate.ts:333-380, apps/web/src/stores/projectStore.ts:1109-1171

Missing proof: Run a two-space template round-trip with nondefault clearance/countertop and compare persisted fields.

### FM-02 — Configurable CSV implements fixed presets, not the full historical editor

The domain exposes delimiter, header, preset and material filter; UI uses these four settings and UTF-8 Blob output. No arbitrary column order or encoding selection exists in this inspected flow.

Expected: Historical F073 acceptance asks for column selection/reordering, saved workshop presets and UTF-8/Latin-1 choice; these cannot be promised by the current fixed-preset UI.

Impact: Customers needing a custom importer layout may require external edits. Existing fixed CSV presets are not declared broken.

Action: Reconcile the promised export scope with supported presets; implement custom settings only if importer requirements justify them, with exact software import/readback.

Evidence: packages/domain/src/cutListConfigurableCsv.ts:10-46, packages/domain/src/cutListConfigurableCsv.ts:125-167, packages/ui/src/production/CsvExportConfigModal.tsx:33-80

Missing proof: Export each supported preset and import into the exact receiving software/version; verify settings persistence only if claimed.

### FM-03 — Project drilling cache omits resolution context and selects the first part owner

cacheKey includes module ID and optional custom dimensions, but not the item measurement preset/options/context. Resolution runs once per key, and keyByPartId keeps the first owner across cached variants. Export callers consume these patterns.

Expected: Each quote line must derive drilling from its exact resolved part and item configuration, without borrowing another line’s joint context.

Impact: Different configurations of the same module could receive incorrect derived placements. Wrong output and physical damage have NOT been reproduced; distinct from the separately reproduced provenance-loss finding.

Action: Key/reconcile drilling by exact line/occurrence and complete resolution context; add two-line differential fixtures before any machine claim.

Evidence: packages/domain/src/projectDrilling.ts:90-180, apps/web/src/exports/useExportHandlers.ts:433-450, apps/web/src/exportProductionPack.ts:159-165

Missing proof: Resolve two lines sharing a module but differing preset/options/custom dimensions; independently compare each drilling result and then exact software readback.

### FM-04 — Legacy cut preview clamps oversized pieces to fit the sheet

The preview packer uses Math.min on each piece dimension against sheet size minus kerf. The production-pack caller invokes this legacy preview with default sheet settings.

Expected: An oversized piece should produce an explicit does-not-fit diagnostic or an accurately scaled out-of-sheet representation, not silently shrink to fit.

Impact: The PDF can visually suggest feasibility for an oversized part. This concerns the legacy visual preview, not the separate nesting optimizer or a machine export.

Action: Reject or visibly flag oversized parts in the preview and pass actual sheet settings; preserve original dimensions in visualization.

Evidence: packages/excel/src/cutPreviewPdfExport.ts:31-33, packages/excel/src/cutPreviewPdfExport.ts:69-128, packages/excel/src/cutPreviewPdfExport.ts:134-147, apps/web/src/exportProductionPack.ts:177-188

Missing proof: Render a 3000×500 mm piece on a 2440 mm sheet and assert explicit overflow/diagnostic, then inspect the produced PDF.

### FM-05 — Mounted Web hardware gizmo has no move/rotate event wiring

HardwarePlacementGizmo defines handleMove and handleRotate but never calls them. Rendered handles only toggle activeHandle on pointer down/up. FurnitureScene3D mounts this component and passes its change callback.

Expected: Visible drag/rotation handles should drive the placement command with snap and observable persisted feedback.

Impact: The Web viewport handles cannot mutate placement through this component’s rendered event path. Manual fields, other editors and native SketchUp are outside this finding.

Action: Connect drag/rotation events to the existing placement command path; verify snap, cancellation, undo and saved position in a real viewport before demonstrating hardware manipulation.

Evidence: packages/ui/src/preview3d/HardwarePlacementGizmo.tsx:68-152, packages/ui/src/preview3d/FurnitureScene3D.tsx:514-543

Missing proof: In a real WebGL viewport select a hardware placement, drag X/Y and rotate Z, assert changed coordinates, undo and save/reload. Keep manual-input behavior separately tested.


## Subsequent independent pure-domain reproduction

- **FM-01:** 3 assertions reproduce template conversion loss of spaces, activeSpaceId, clearance, wall cabinet height and countertop settings. See `template-roundtrip-proof.md` and `data/template-roundtrip-proof.json`. UI/store/API persistence remains unverified.
- **FM-03:** first-part-owner reuse is reproduced across two different customDims cache keys: the larger door has 3 hinge cups independently, 2 after the smaller module, and 3 after reversing order. See `data/drilling-context-proof.json`. Missing preset/options key dimensions were not independently isolated. No exported-file, machine or physical-damage claim.

These proofs supersede the earlier static-only runtime boundaries for those two mechanisms, not their full feature acceptance status.
