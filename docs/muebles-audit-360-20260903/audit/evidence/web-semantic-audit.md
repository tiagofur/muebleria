# Web semantic audit supplement

Current source review is bounded, not full acceptance: 29 primary screen fragments; 26 targeted test bodies inspected without execution. Secondary/inline coverage is classified below; a reviewed shared primitive does not certify its consumer. Existing independent browser and pure-domain proofs remain in their own artifacts.

## Current depth counts

```json
{
  "primaryScreens": 29,
  "semanticScreenFragments": 29,
  "runtimeCertifiedScreens": 0,
  "testBodiesInspected": 26,
  "secondarySurfacesAccounted": 259,
  "secondaryExactFileContextLinks": 0,
  "secondarySemanticallyCertified": 0,
  "inlineFilesAccounted": 140,
  "inlineExactFileContextLinks": 21,
  "inlineSemanticallyCertified": 0,
  "sharedContractsReviewed": 23,
  "secondaryAuditDepthCounts": {
    "REUSED_FEATURE_FILE_FRAGMENT": 28,
    "SEMANTIC_COMPONENT_FRAGMENT": 141,
    "SEMANTIC_SHARED_OR_CHILD_CONTRACT": 25,
    "REVIEWED_REUSED_PATTERN_ONLY": 39,
    "NONINTERACTIVE_LITERAL_CLASSIFIED": 26
  },
  "secondaryOnlyPendingNoSemanticContext": 0,
  "secondaryConsumerBehaviorComplete": 0,
  "inlineAuditDepthCounts": {
    "REVIEWED_REUSED_PATTERN_ONLY": 44,
    "SEMANTIC_COMPONENT_FRAGMENT": 49,
    "REUSED_FEATURE_FILE_FRAGMENT": 27,
    "SEMANTIC_SHARED_OR_CHILD_CONTRACT": 20
  },
  "inlineOnlyPendingNoSemanticContext": 0,
  "inlineConsumerBehaviorComplete": 0,
  "componentFragmentFiles": 132,
  "secondaryDirectScreenCallerLinks": 73
}
```

## Primary screens

### WEB-home — Dashboard
Loading exits into a named page loader. Home mode selects sales/engineering onboarding language; getting-started logic is intentionally omitted for sales.

Open-project/catalog/new-project actions are callback-owned; this fragment does not prove role-specific server payloads.

Test scope: loading placeholder excludes project content. Inspection, not execution.

Evidence: `packages/ui/src/dashboard/Dashboard.tsx:143-174`

### WEB-quotes — ProjectsScreen
Export blocking distinguishes missing required options, disallowed state and last-attempt validation errors. Loading is separate; selected project enters the detail view with breakdown loading/error state.

Project identity and mutation/export authority come from store/caller. Detail pricing, revision history and authoring need their separately linked audits.

Test scope: renders rich project cards with status and quoted value. Inspection, not execution.

Evidence: `packages/ui/src/projects/ProjectsScreen.tsx:677-713`

### WEB-customers — CustomersScreen
Submit validates locally, invokes create/update and immediately closes the modal. Owner column is conditional on canAssignOwner; customer active status is distinct.

Callback boundary cannot confirm persisted success. Owner assignment display is not API isolation.

Test scope: default active filtering excludes inactive customer. Inspection, not execution.

Evidence: `packages/ui/src/customers/CustomersScreen.tsx:153-213`

### WEB-showcase — ShowcaseScreen
Portfolio is default; linked tab/panel switches to module catalog. Portfolio loading and use-as-reference/use-in-quote callbacks are forwarded to the distinct children.

This is a sales presentation surface, not a manufacturing editor; permissions and media grants remain caller-owned.

Test scope: clicking module tab changes the displayed child. Inspection, not execution.

Evidence: `packages/ui/src/showcase/ShowcaseScreen.tsx:19-85`

### WEB-plantBoard — PlantBoardScreen
Read-only board includes accepted/produced projects and computes sector summary through domain helper; empty state directs users toward quote acceptance.

Projects explicitly arrive ownership-filtered. Optional production-order navigation is wired only for allowed roles; this component itself does not authorize requests.

Test scope: No same-basename test found; other test names were not excluded. Inspection, not execution.

Evidence: `packages/ui/src/production/PlantBoardScreen.tsx:20-68`

### WEB-production — FabricScreen
Branching distinguishes no visible sectors, no pending jobs and no cards in the current tab. Tab panels are labelled; actions remain station/physical-entity specific.

Physical part/unit progression is a separate callback/server contract, not inferred from the visible button.

Test scope: workflow tabs link aria-controls to mounted panels. Inspection, not execution.

Evidence: `packages/ui/src/production/FabricScreen.tsx:759-815`

### WEB-shipments — EmbarquesScreen
Dispatch cards first require accepted/produced and legacy item floorStatus packaged/loaded, then calculate package/unit progress; empty state says nothing to load.

Important legacy eligibility boundary: pure helper test does not prove physical-unit-only projects are included; verify that combination before operational claims.

Test scope: helper excludes draft/nonpackaged projects and keeps packaged/loaded ones. Inspection, not execution.

Evidence: `packages/ui/src/production/EmbarquesScreen.tsx:32-108`

### WEB-installations — InstalacionesScreen
Cards count legacy loaded/installed item states while also retaining projects with installation visits/issues/punch/closeout work; empty state directs from shipments.

Card counts are not proof of per-unit execution completeness. Customer contact is a supplied lookup and needs authorization at caller/API.

Test scope: helper includes loaded work and excludes completed-only projects without active job. Inspection, not execution.

Evidence: `packages/ui/src/production/InstalacionesScreen.tsx:34-115`

### WEB-orders — ProductionWorkspace
Production scope recomputes cut rows and hardware via domain functions; failures are preserved separately rather than treated as empty. Piece and module label errors are distinct.

Display/readiness and export callbacks do not establish a released exact Design revision or machine compatibility.

Test scope: missing material release displays guidance and invokes warehouse navigation. Inspection, not execution.

Evidence: `packages/ui/src/production/ProductionWorkspace.tsx:234-303`

### WEB-productionDashboard — ProductionManagerDashboard
Loading uses role=status; failed metrics load uses alert with explicit refresh. Sector filter intersects jobs with sector activity IDs.

Metrics hook/source authority is outside this small view fragment; no throughput accuracy claim from display.

Test scope: rendered project count includes accepted/produced projects including empty-item project. Inspection, not execution.

Evidence: `packages/ui/src/production/ProductionManagerDashboard.tsx:143-187`

### WEB-salesDashboard — SalesDashboard
Monthly subset uses createdAt cohort and priceSnapshot values rather than actual receipt or close events. Sales visibility is supplied/filtered, not security enforced by these sums.

Label and data-truth proof must distinguish quoted pipeline from actual income.

Test scope: empty project input shows empty state. Inspection, not execution.

Evidence: `packages/ui/src/sales/SalesDashboard.tsx:115-143`

### WEB-engineeringDashboard — EngineeringDashboard
Period filter prefers engineering startedAt but falls back to createdAt/updatedAt; then delegates analytics and filters table by engineer/search.

Fallback date is a proxy, not an exact engineering start event. Owner/role filtered input and full data truth require caller evidence.

Test scope: queue CTA invokes provided onOpenQueue callback. Inspection, not execution.

Evidence: `packages/ui/src/engineering/EngineeringDashboard.tsx:65-109`

### WEB-engineering — EngineeringScreen
Working queue is projectProcessStage=ingenieria; sent section receives almacen/produccion. Search and engineering-status filters operate within working queue.

Start-engineering action and server transition remain separate; sent UI is not evidence of physical release.

Test scope: provided projects render in queue list. Inspection, not execution.

Evidence: `packages/ui/src/engineering/EngineeringScreen.tsx:70-105`

### WEB-warehouseDashboard — WarehouseDashboard
Dashboard delegates to computeWarehouseDashboardStats with nullable stock/orders/picking and filters projects by fully-picked status.

Missing source datasets must not become invented business totals; actual mutation atomicity is covered by WEB-01, not these derived cards.

Test scope: mock domain inputs render dashboard stat cards. Inspection, not execution.

Evidence: `packages/ui/src/purchasing/WarehouseDashboard.tsx:58-86`

### WEB-warehouse — PurchasingScreen
Release action requires canMarkPicked plus callback. When planning exists it opens coverage/reservations/evidence view; otherwise it directly calls legacy onReleaseMaterials.

This inspected split matters: UI gate is not stock transaction authority. See WEB-01 for independently established non-atomic dispatch boundary.

Test scope: hardware picking lists render per project from supplied data. Inspection, not execution.

Evidence: `packages/ui/src/purchasing/PurchasingScreen.tsx:425-453`

### WEB-modules — ModulesScreen
Screen forwards create/update/delete and editor slots into state hook; loading is explicit. EntityEditorLayout receives selected entity, inline editor and discard confirmation state.

The wrapper does not prove state-hook persistence, material parity or all discard paths.

Test scope: source-shape guard checks card layout and inline editor; not interaction proof. Inspection, not execution.

Evidence: `packages/ui/src/modules/ModulesScreen.tsx:186-234`

### WEB-structures — StructuresScreen
Save blocks duplicate code, zero components and nonpositive presets, and selects the relevant error tab. Valid submit invokes callback and force-closes; delete also updates local selection.

Composed components replace historical direct-board structure. No confirmed backend commit follows merely from close.

Test scope: active-only list rendering with inactive structure excluded. Inspection, not execution.

Evidence: `packages/ui/src/structures/StructuresScreen.tsx:354-409`

### WEB-components — ComponentsScreen
Save requires unique code/name and positive geometry unless length/width formula replaces a base dimension; thickness remains positive. Failure opens geometry tab and names fields.

Sample-container formula validation is authoring assistance, not authoritative all-instance resolution.

Test scope: active filtering renders current components and excludes inactive one. Inspection, not execution.

Evidence: `packages/ui/src/components/ComponentsScreen.tsx:340-388`

### WEB-addOns — AgregadosScreen
Save rejects blank code/name or case-insensitive duplicate code, focuses general tab, generates client ID for create, invokes callback and closes editor.

No server persistence or concurrency is proved by local generated ID and closing.

Test scope: No same-basename test found; other test names were not excluded. Inspection, not execution.

Evidence: `packages/ui/src/agregados/AgregadosScreen.tsx:175-205`

### WEB-materials — MaterialsCatalog
Save derives costPerM2 through supplied calculator from board dimensions/price/waste; normalizes color/texture and clamps PBR fields before create/update then close.

Effective material thickness/BOM and persisted cost accuracy require domain/server parity; local normalized preview is not manufacturing truth.

Test scope: requestCreateKey transition opens creation dialog. Inspection, not execution.

Evidence: `packages/ui/src/catalogs/materials/MaterialsCatalog.tsx:314-356`

### WEB-edges — EdgesCatalog
Save validates and normalizes preview color then invokes callback/close. Cost column is filtered when showCosts is false.

Column hiding is not redaction of API payload. Save failure/reopen requires caller proof.

Test scope: provided edge records render as rows. Inspection, not execution.

Evidence: `packages/ui/src/catalogs/EdgesCatalog.tsx:146-193`

### WEB-hardware — HardwareCatalog
Save validates then invokes create/update and closes. Catalog rows use resolved image URLs with name alt, unit labels and cost.

Catalog editing differs from viewport placement; FM-05 only concerns the Web gizmo, not this form.

Test scope: form entry produces one onCreate draft with expected code/name. Inspection, not execution.

Evidence: `packages/ui/src/catalogs/hardware/HardwareCatalog.tsx:148-194`

### WEB-finishes — AmbientMaterialsCatalog
Ambient material save normalizes category/texture dimensions, clamps PBR fields and invokes callback/close.

Ambient visual material is not a priced MaterialBoard; do not infer BOM/cost changes from PBR edits.

Test scope: provided ambient materials render rows. Inspection, not execution.

Evidence: `packages/ui/src/catalogs/ambient/AmbientMaterialsCatalog.tsx:202-239`

### WEB-optionGroups — OptionGroupsScreen
Save validates, trims code/name and filters selected option IDs against current candidate members before callback/close.

Selected member filtering does not prove concurrent catalog changes, server validation or consumer required-option behavior.

Test scope: No same-basename test found; other test names were not excluded. Inspection, not execution.

Evidence: `packages/ui/src/optionGroups/OptionGroupsScreen.tsx:220-239`

### WEB-settings — SettingsScreen
Form validates margin, labor, currency, kerf and trim values, exposing actionable error text instead of calling save for invalid inputs.

Workshop persistence and export use of defaults need caller/reload proof; settings display is not machine-profile compatibility.

Test scope: valid input emits expected defaults and workshop settings via onSave. Inspection, not execution.

Evidence: `packages/ui/src/settings/SettingsScreen.tsx:116-151`

### WEB-devices — DevicesScreen
Device load errors are separate from directory contents. Approval is awaited through shared step-up, only result triggers success; cancellation returns idle. Revocation awaits API and reload.

Current-user directory and enrollment command require server exact scope; tests here use stubbed fetch, not a real device.

Test scope: typed step-up retry reuses Idempotency-Key and reloads directory using stubbed fetch. Inspection, not execution.

Evidence: `packages/ui/src/settings/DevicesScreen.tsx:30-99`

### WEB-security — SecurityScreen
Enrollment and verification are separate awaited phases, invalid/expired codes have distinct feedback, recovery and removal use shared step-up and refresh factors.

Provisioning secrets remain in UI lifecycle; real authenticator, absolute sessions and cross-org denial need integration proof.

Test scope: mock enrollment verifies QR, recovery-code panel/dismissal and absence of named storage keys. Inspection, not execution.

Evidence: `packages/ui/src/security/SecurityScreen.tsx:100-181`

### WEB-users — UsersScreen
LAST_ADMIN opens transfer flow. Role mutation awaits step-up through mutation wrapper but ignores cancellation return before success toast; this is the existing WEB-02 finding.

Membership actions are not global account authority. Do not duplicate WEB-02; real cancellation and role transfer need separate runtime evidence.

Test scope: first inspected test is only a source contract guard for generated client and absence of legacy routes. Inspection, not execution.

Evidence: `packages/ui/src/users/UsersScreen.tsx:271-299`

### WEB-platform — PlatformScreen
Provisioning requires active+ready response before success; update and support session check step-up return before success. Errors remain in modal and submitting always resets.

Global account/platform organization authority is separate from membership management; support enters via exact response callback, not implicit membership.

Test scope: stubbed audit fetch failure shows retry error rather than empty state; retry resolves to empty. Inspection, not execution.

Evidence: `packages/ui/src/platform/PlatformScreen.tsx:211-295`

## Shared contract reviews

### WEB-PATTERN-Modal
Portal to body; delayed unmount, body scroll lock, initial/return focus, Tab wrapping and Escape/backdrop close. Child onClose owns dirty/busy policy. Nested modal stacking and ancestor-hidden focusables need runtime proof.

### WEB-PATTERN-ConfirmDialog
Invokes onConfirm then onClose synchronously. It does not await an async mutation or own pending/error state; caller must supply that behavior or use a different contract.

### WEB-PATTERN-FullscreenDialog
Body portal with initial/restore focus, tab wrapping and optional Escape listener. Caller renders its own chrome; escapeEnabled allows explicit overlay coordination, not automatic stack ownership.

### WEB-PATTERN-DropdownMenu
Enabled entries receive roving highlight; keyboard/click invokes onSelect, closes and restores trigger focus. Menu stays in local DOM (not portal), so clipping depends on consumer ancestors; async command success is not managed here.

### WEB-PATTERN-CatalogTable
Presents passed rows; optional detail expansion only when callback and renderer exist. Enter/Space on row avoids nested controls; action wrapper stops propagation. Empty text is not network-error handling or authorization.

### WEB-PATTERN-WorkspaceTabs
Workspace/workflow variants share linked tab IDs, selected state and enabled-only roving hook. Hook wraps Arrow keys and supports Home/End. Caller must render matching panels and own activation side effects.

### WEB-PATTERN-WorkflowTabs
Same shared tab contract as WorkspaceTabs; semantic workflow ordering does not authorize a transition.

### WEB-PATTERN-EntityEditorLayout
Selects inline editor, selected detail or list; renders caller form slots, routes Back through closeModal and discard through forceCloseEditor. Dirty computation and mutation success are owned by state hook/caller, not layout.

### WEB-PATTERN-ScreenBoundary
Render-error fallback displays alert, error detail, retry and optional home. This wrapper does not catch rejected event-handler promises or replace query error state.

### WEB-PATTERN-ProjectConfirmDeleteModal
Displays exact project name and irreversible-delete warning; confirmation directly delegates to caller without local async state.

### WEB-PATTERN-ProjectConfirmReopenModal
Warns reopening clears frozen pricing and recalculates catalog; delegates command, so current server/history semantics must be compared separately.

### WEB-PATTERN-ProjectSaveAsTemplateModal
Resets template name on open; required input submits name callback. Copy promises layout preservation; FM-01 demonstrates missing modern layout in domain conversion, not tested UI persistence.

### WEB-PATTERN-HardwareFormModal
Receives draft/error/submit externally and resets 3D disclosure per open. Footer submit targets exact formId. This fragment covers form ownership/reset, not all machining fields or save authorization.

### WEB-PATTERN-StockMovementModal
Validates selected material, signed nonzero adjustment or positive movement, and required adjustment note; awaits onSubmit before closing, retains error and resets saving on failure. Backdrop/cancel still delegate directly.

### WEB-PATTERN-StudioDeleteDialog
Resets scope per selected placement; distinguishes plan removal versus entire quote line, disables unavailable project removal and lists other-space consequences. Caller owns actual deletion/undo/server command.

### WEB-PATTERN-ChangeOrderModal
Create requires reason, parses impact values and awaits callback before clearing draft/list navigation. Busy resets in finally; this local handler has no catch/error state, so error feedback depends on the caller. Custom modal markup is not the reviewed Modal primitive.

### WEB-PATTERN-ProductionReleaseModal
Release derives current/revoked state and gates from domain; requires allowed result or revoke reason, awaits callback before close and resets busy. This legacy project-release UI is not proof of exact DesignRevision release or server gate enforcement.

### WEB-PATTERN-QualityPanel
Quality view separates pending physical module-QC units. Issue report form requires canManage plus handler, trims description and clears it immediately after optional callback; persisted failure feedback requires caller review.

### WEB-PATTERN-PurchaseOrdersPanel
PO submission filters valid material/positive quantity lines, requires supplier, and closes only after awaited save inside run. Receiving validates against remaining quantities and sends positive lines before close; server atomic stock posting remains separate.

### WEB-PATTERN-SiteSurveyPanel
Capture requires positive finite width/height; optional positive depth and note are sent through handlers. Draft/capture closes immediately without awaiting callback. Empty state only offers start when canCapture and handler exist; freeze/approval server gates remain separate.

### WEB-PATTERN-WarrantyTicketsPanel
Ticket creation awaits callback before closing. Resolve sends client timestamp and a default positive resolution note when blank, then clears local state; handler has finally but no local catch. Authoritative actor/time, notes and error display need server/caller proof.

### WEB-PATTERN-HardwarePlacementsEditor
Manual placement editor updates by draft array index and emits onChange; remove emits undefined when empty, add defaults first hardware/front/50mm. Rotation merges selected axis. This draft form is distinct from broken viewport gizmo; persistent occurrence identity is not established here.

### WEB-PATTERN-AdminTransferModal
Transfer shows no-eligible-member and reloadable error states, requires target/reason and disables confirm while busy. It sends exact membership ID via callbacks; transaction and step-up cancellation are owned by UsersScreen and linked WEB-02.

## Secondary and inline ledger

See `web-secondary-coverage.md` for each retained export/inline record, audit depth and precise missing proof. Source fragment files remain embedded in `data/web-semantic-audit.json`. No accessibility/performance/responsive score or full consumer pass is fabricated.
