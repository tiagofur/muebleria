# Web audit — source snapshot 316df57c

## Scope and evidence boundaries
29 NAV destinations, 28 detail/tab patterns, 259 exported secondary components and 140 files containing inline surfaces are indexed in `data/web-inventory.json`. The inventory is exhaustive for the parsed NAV map and exported TSX symbols in Web/shared UI, not a claim that every shared component is mounted. Caller references distinguish known mount sites.

Primary screens have structural/static assessments. Secondary and inline surfaces have exact source markers for states, actions, validation, permissions, labels and CSS. **Markers are not behavior verification.** No tests or product changes were made by this worker. No feature is COMPLETE. Runtime screen/state matrix remains NEEDS VERIFICATION and must be joined with `data/runtime-ui.json` and vertical evidence.

Impeccable assessment: accessibility, performance, responsive, theming and anti-pattern health scores are UNKNOWN here. No invented numerical score or visual verdict from JSX. Design and operational UX authority were read; computed contrast/focus/keyboard/real viewport evidence is required.

## Confirmed static defects

### WEB-01 — Picking debits can commit without dispatched state (HIGH)
Each stock movement is awaited individually; compensation covers only errors inside debit loop. persistPicking runs after that catch. Failure there reaches outer fail(), which reloads picking and stock but does not compensate successful debits. Reverse path likewise uses multiple writes.

Expected: One authoritative transactional/idempotent command links ledger, picking and reservation consumption.

Impact: Retry after partial failure can repeat stock debit; inventory and dispatch status diverge.

Evidence: apps/web/src/stores/purchasingStore.ts:360-425; packages/storage/src/apiWorkspaceRepository.ts:1722-1738; packages/storage/src/apiWorkspaceRepository.ts:1779-1808

Recommendation: Move dispatch transition and ledger effects into atomic server command; test failure after final debit and retry without duplicate debit.

Verification still needed: NEEDS VERIFICATION; no test execution in this worker

### WEB-02 — Team step-up cancellation still reports command success (HIGH)
stepUp.run resolves null on cancel or MFA-required. Roles, admin transfer and revoke-session handlers discard result and show success. Offboard skips only cache update on null but still executes outer success toast and closes dialog.

Expected: Cancelled or unmet MFA must preserve the action without claiming completion; only committed result triggers success.

Impact: Operator can believe sessions were revoked or membership ended while server action never happened.

Evidence: packages/ui/src/security/stepUp.tsx:84-115; packages/ui/src/users/UsersScreen.tsx:283-296; packages/ui/src/users/UsersScreen.tsx:338-351; packages/ui/src/users/UsersScreen.tsx:400-413; packages/ui/src/users/UsersScreen.tsx:420-430

Recommendation: Return an explicit executed/cancelled result through mutation wrapper; gate all outer success side effects. Add cancellation and MFA-required tests for all four commands.

Verification still needed: NEEDS VERIFICATION; no test execution in this worker

### WEB-03 — Catalog and settings failures masquerade as legitimate empty/default data (HIGH)
getCatalog catches structures/components/agregados/ambient/material-category request failures and supplies empty arrays. getWorkshopSettings maps non-OK and thrown errors to defaults. This includes outages/authorization failures, not just missing legacy endpoints.

Expected: Expose typed unavailable/error state and preserve last confirmed data rather than silently substituting empty/default configuration.

Impact: Demo can display an empty catalog or incorrect default financial/manufacturing settings instead of the actual failure.

Evidence: packages/storage/src/apiWorkspaceRepository.ts:324-335; packages/storage/src/apiWorkspaceRepository.ts:372-401

Recommendation: Remove broad silent fallback; distinguish deliberate optional availability from failed required data; test 403/500/network/parse failures and rendered recovery.

Verification still needed: NEEDS VERIFICATION; no test execution in this worker

### WEB-04 — Settings shows saved before persistence finishes (MEDIUM)
SettingsScreen onSave has void signature and is not awaited; immediately sets savedFlash. Shell async save can later report error and store rolls back, so contradictory success/error feedback occurs.

Expected: Show pending while saving; success only after authoritative save; retain editable input and failure feedback.

Impact: Changes appear saved during slow or failed network; undermines trust in workshop settings.

Evidence: packages/ui/src/settings/SettingsScreen.tsx:16; packages/ui/src/settings/SettingsScreen.tsx:153-173; apps/web/src/AppContent.tsx:1423-1437; apps/web/src/stores/workspaceStore.ts:852-871

Recommendation: Use Promise-returning save prop with pending state; stop swallowing outcome at shell boundary; await before saved flash. Preserve existing rollback.

Verification still needed: NEEDS VERIFICATION; no test execution in this worker

### WEB-05 — Purchasing uses first role instead of granted role union (MEDIUM)
AppContent actorRole is actorRoles[0]; ShellView passes it to PurchasingScreen. canMarkPicked checks only null/admin/almacen; stock/purchasing controls derive from it. Shell handlers already use union.

Expected: UI capabilities must match union of effective roles; role ordering must not hide permitted actions.

Impact: Multi-role staff can reach workspace but lose stock/dispatch/PO controls depending on first role. This is a UI denial, not evidence of server authorization bypass.

Evidence: apps/web/src/AppContent.tsx:611; apps/web/src/AppContent.tsx:689; apps/web/src/ShellView.tsx:1303-1306; packages/ui/src/purchasing/PurchasingScreen.tsx:292; packages/ui/src/purchasing/PurchasingScreen.tsx:716-725

Recommendation: Pass explicit canMarkPicked/canManagePurchasing capabilities (or roles union), with role-order permutation tests.

Verification still needed: NEEDS VERIFICATION; no test execution in this worker

## Screen-by-screen static review

### WEB-home — / (Dashboard)
Dashboard recibe métricas/excepciones del shell y ofrece accesos condicionados. Verificar origen temporal y etiquetas actual/estimated/proxy de cada KPI, no asumir exactitud por cards.

Source: packages/ui/src/dashboard/Dashboard.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-quotes — /quotes (ProjectsScreen)
ProjectsScreen delega lista, detalle y modales: ProjectDetailView, ProjectsListView, ProjectModalsContainer y useProjectsScreenState. La evaluación debe incluir esos hijos, no sólo wrapper. Proyectar tiene hallazgos runtime externos RT-UX-01/02.

Source: packages/ui/src/projects/ProjectsScreen.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-customers — /customers (CustomersScreen)
Distingue lista sin clientes de búsqueda sin resultados y valida antes de guardar. Comprobar create/edit/active y detalle profundo contra API/ownership; no inferir éxito por cierre de modal.

Source: packages/ui/src/customers/CustomersScreen.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-showcase — /showcase (ShowcaseScreen)
Dos tabs reales: Portafolio de Obras y Catálogo de Módulos; callbacks de usar módulo/referencia. No confundir vitrina visual con publicación comercial entre organizaciones.

Source: packages/ui/src/showcase/ShowcaseScreen.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-plantBoard — /plant-board (PlantBoardScreen)
Vista de avance read-only con EmptyState; no certificar porcentajes sin confrontar unidades/eventos del backend. Visible por múltiples roles.

Source: packages/ui/src/production/PlantBoardScreen.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-production — /production (FabricScreen)
FabricScreen tiene tabs de workflow, selección de tarjetas y vacíos diferenciados. Requiere prueba por estación, claim/concurrencia y pieza→unidad, no sólo clicks locales.

Source: packages/ui/src/production/FabricScreen.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-shipments — /shipments (EmbarquesScreen)
Lista y detalle EmbarquesProjectDetail son superficies distintas. Verificar bulto/unidad, staging/loading y ownership. EmptyState no prueba ausencia real de datos.

Source: packages/ui/src/production/EmbarquesScreen.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-installations — /installations (InstalacionesScreen)
Lista y detalle InstalacionesProjectDetail; exige visita/unidad, incidencias/punch/sign-off y persistencia. Vista móvil industrial requiere prueba táctil, cámara y conexión degradada.

Source: packages/ui/src/production/InstalacionesScreen.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-orders — /orders (ProductionWorkspace)
ProductionWorkspace distingue falta de liberación de materiales, aún no en fábrica y orden no encontrada, con acciones de recuperación. Hub de nueve tabs y exportaciones necesita prueba de revisión exacta y output, no sólo render.

Source: packages/ui/src/production/ProductionWorkspace.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-productionDashboard — /production-dashboard (ProductionManagerDashboard)
Dashboard de supervisor con acciones de abrir cola/proyecto y filtros; exactitud de indicadores necesita endpoints/eventos reales, no presencia de títulos.

Source: packages/ui/src/production/ProductionManagerDashboard.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-salesDashboard — /sales-dashboard (SalesDashboard)
Cuenta con EmptyState, header y toolbar; validar fechas y agregaciones comerciales frente a eventos reales y visibilidad de costos por rol.

Source: packages/ui/src/sales/SalesDashboard.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-engineeringDashboard — /engineering-dashboard (EngineeringDashboard)
Header y acciones conectadas a cola/obra; verificar tiempos y estados de ingeniería sin tomar createdAt como evento sustituto.

Source: packages/ui/src/engineering/EngineeringDashboard.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-engineering — /engineering (EngineeringScreen)
Lista y EngineeringWorkspace por proyecto separadas. EmptyState para filtros y sin proyectos; gate de enviar/liberar debe verificarse contra backend y revisión.

Source: packages/ui/src/engineering/EngineeringScreen.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-warehouseDashboard — /warehouse-dashboard (WarehouseDashboard)
Paneles de órdenes, salud de inventario y alertas. Click de proyecto en shell lleva a cola general, no detalle específico; revisar fricción de contexto en demo.

Source: packages/ui/src/purchasing/WarehouseDashboard.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-warehouse — /warehouse (PurchasingScreen)
Stock y Órdenes/proveedores son tabs dentro de Compras; existe planning panel con evidencia. WEB-01 y WEB-05 afectan confiabilidad y permisos visibles.

Source: packages/ui/src/purchasing/PurchasingScreen.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-modules — /modules (ModulesScreen)
Wrapper delega ModulesListView/ModuleDetailView/ModuleEditorPage y helpers. Requiere resolver autoritativo, edición new/id, cancelar y preview; presencia de editor no prueba roundtrip SketchUp.

Source: packages/ui/src/modules/ModulesScreen.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-structures — /structures (StructuresScreen)
Valida códigos y referencias antes de guardar; editor grande usa ruta /structures/:id/edit. WEB-03 puede transformar error de carga en estructura vacía.

Source: packages/ui/src/structures/StructuresScreen.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-components — /components (ComponentsScreen)
Valida código/nombre/formulas con mensajes concretos; editor grande /components/:id/edit. Falta runtime de fórmula inválida/roles y persistencia; WEB-03 altera carga.

Source: packages/ui/src/components/ComponentsScreen.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-addOns — /add-ons (AgregadosScreen)
Rechaza código/nombre ausentes y código duplicado; lectura depende del catálogo con fallback WEB-03. Comprobar binding/preview y rollback real.

Source: packages/ui/src/agregados/AgregadosScreen.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-materials — /materials (MaterialsCatalog)
Categorías y vacíos diferenciados; incluye costPerM2 desde shell y subida de imagen condicionada. Probar mm/espesor/unidades/costo junto con persistencia; categorías afectadas por WEB-03.

Source: packages/ui/src/catalogs/materials/MaterialsCatalog.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-edges — /edges (EdgesCatalog)
Lista/detalle y validación antes de save. Revisar unidad costo/ml, espesor y efectos de tapacanto con dominio real, no lectura de inputs.

Source: packages/ui/src/catalogs/EdgesCatalog.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-hardware — /hardware (HardwareCatalog)
Lista/detalle, validaciones y permiso showCosts. Este catálogo no demuestra por sí solo placements/contactos/perforaciones en diseño; enlazar flujo vertical de hardware.

Source: packages/ui/src/catalogs/hardware/HardwareCatalog.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-finishes — /finishes (AmbientMaterialsCatalog)
Categorías y materiales de ambiente son presentación, no tablero de fabricación. Mantener distinción explícita; fallback de carga WEB-03.

Source: packages/ui/src/catalogs/ambient/AmbientMaterialsCatalog.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-optionGroups — /option-groups (OptionGroupsScreen)
Lista/detalle con validación de opciones; probar edición/cancelación y bindings consumidores, no asumir que un grupo guardado resuelve toda fórmula.

Source: packages/ui/src/optionGroups/OptionGroupsScreen.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-settings — /settings (SettingsScreen)
Valida margen, mano de obra, moneda, kerf y refile. Tiene tabs y red condicional factory. WEB-03/04 son riesgos de defaults y guardado falso.

Source: packages/ui/src/settings/SettingsScreen.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-devices — /devices (DevicesScreen)
Aprobación y lista de dispositivos separados; verificar enrollment exact-scope, step-up cancelación y revocación con backend. No confundir grant iniciado con dispositivo autorizado.

Source: packages/ui/src/settings/DevicesScreen.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-security — /security (SecurityScreen)
MFA enrolamiento, factores y códigos de recuperación; secretos/confirmaciones necesitan prueba real y revisión de cancelación. No mostrar códigos reales en evidencias públicas.

Source: packages/ui/src/security/SecurityScreen.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-users — /users (UsersScreen)
Distingue membresía/cuenta y capacidades; invita, administra roles, transferencia, revocación y offboard. WEB-02 impide confiar en mensajes de éxito de cuatro commands.

Source: packages/ui/src/users/UsersScreen.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

### WEB-platform — /platform (PlatformScreen)
Tres tabs: Organizaciones, Usuarios Globales, Auditoría de Seguridad. Acceso isPlatformAdmin; probar provisioning/rollback y soporte sin mezclar administración de membresías.

Source: packages/ui/src/platform/PlatformScreen.tsx; caller references and state/action/validation/permission/CSS evidence are indexed in JSON. Status: UNKNOWN runtime; source inventory CONFIRMED.

## Secondary surface audit contract
The `secondaryInterfaces` array indexes all 259 exported TSX components (not just Screen suffixes), while `inlineSurfaces` indexes inline dialogs/forms/tables/menus/selectors/panels. Each carries caller/source references. Unresolved external/local component exports and missing direct API calls are explicitly unknown, not absence. Nine order tabs, entity details/editors, invitation and gated login/org-selection flows are included.

## Priority and safe demo use
1. Resolve/verify WEB-01 before live stock dispatch with valuable data.
2. Resolve WEB-02 before showcasing security administration.
3. Remove or surface WEB-03 load failures before relying on catalog/settings data.
4. Resolve WEB-04 and WEB-05 before settings and multi-role warehouse demo.
5. Proyectar phone/tablet issue RT-UX-01 is a conditional demo blocker; root runtime evidence covers guest only. RT-UX-02 documents default framing. Do not duplicate these findings.

## Remaining UNKNOWN / NEEDS VERIFICATION
- Authenticated browser role/capability/ownership/sector exercise for every primary/detail/secondary surface.
- Every relevant default/loading/empty/partial/success/error/disabled/unauthorized/offline state with real backend; do not count a marker as executed.
- Tab/dialog keyboard focus, Escape/cancel, screen reader labels, computed contrast, 200% zoom and floor/field touch use.
- Catalog settings 403/500/network failures; picking failure after successful debit; step-up cancellation and MFA-required for all four Team commands.
- Exact output revision, physical units, file import/readback and SketchUp roundtrip need separate vertical evidence.
- Callerless shared components require reachability analysis; they are preserved in inventory rather than omitted.

## Key Learnings:
1. An inner mutation callback return does not suppress the outer success branch.
2. A stock debit sequence plus client compensation is not an atomic dispatch.
3. A complete source index is not complete behavioral coverage.

## Navigation role policy evaluation
The inventory includes allowedRoleNames evaluated directly from audited navIdsForRole TypeScript. This is source-policy evidence only: no API, browser, tenant ownership or sector authorization was exercised. Platform uses its independent isPlatformAdmin flag.
