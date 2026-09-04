# Secondary production and catalog source review

Static only; no UI/runtime certification. Existing findings are not duplicated.

## packages/ui/src/catalogs/CatalogPicker.tsx
Filters active catalog entries while preserving a selected inactive entry; searches code/name/subtitle, supports arrow/Enter/Escape search navigation and listbox selection; clearing is wired onMouseDown rather than onClick.

Missing proof: Browser keyboard activation of clear, focus restoration, popover clipping and screen-reader combobox semantics remain untested.

Evidence: packages/ui/src/catalogs/CatalogPicker.tsx:70–116, packages/ui/src/catalogs/CatalogPicker.tsx:175–208, packages/ui/src/catalogs/CatalogPicker.tsx:270–290, packages/ui/src/catalogs/CatalogPicker.tsx:335–350

## packages/ui/src/catalogs/ambient/AmbientCategoryTree.tsx
Recursive category filtering toggles the selected category; management rows invoke edit/delete callbacks, with deletion rendered only when canDelete permits. This component does not persist or enforce hierarchy validity.

Missing proof: Caller permissions, cyclic category input handling, keyboard/screen-reader selected-state feedback and server persistence remain unverified.

Evidence: packages/ui/src/catalogs/ambient/AmbientCategoryTree.tsx:20–77, packages/ui/src/catalogs/ambient/AmbientCategoryTree.tsx:84–150

## packages/ui/src/catalogs/hardware/HardwareMachiningSection.tsx
Edits hardware-owned machining parts and operations immutably; type changes retain ID/offset/face but reset kind-specific defaults. Prevents deleting the last operation, converts numeric inputs with Number, and delegates complete profile validation/persistence to the enclosing form.

Missing proof: Domain validation and save rollback must be proved at parent boundary; no host placement, machining output or physical compatibility claim.

Evidence: packages/ui/src/catalogs/hardware/HardwareMachiningSection.tsx:80–139, packages/ui/src/catalogs/hardware/HardwareMachiningSection.tsx:243–300, packages/ui/src/catalogs/hardware/HardwareMachiningSection.tsx:382–430

## packages/ui/src/catalogs/materials/MaterialExpandedDetail.tsx
Read-only material detail resolves image and displays dimensions/grain/edge/cost/waste/status. Board price and cost per area are rendered by this child without a hideCosts gate; this alone does not establish unauthorized exposure.

Missing proof: Caller visibility and API cost redaction, broken-image UX and responsive detail layout remain unverified.

Evidence: packages/ui/src/catalogs/materials/MaterialExpandedDetail.tsx:24–101

## packages/ui/src/production/EmbarquesProjectDetail.tsx
Uses supplied labels or locally generated fallback (generation error becomes empty labels). Intercepts foreign item IDs only for loaded transitions, displays cross-project alert and blocks release while alert exists; callback Promise is not awaited.

Missing proof: Rejected save feedback, exact physical package identity, refreshed authoritative progress and release command integration remain unverified.

Evidence: packages/ui/src/production/EmbarquesProjectDetail.tsx:60–112, packages/ui/src/production/EmbarquesProjectDetail.tsx:134–168

## packages/ui/src/production/InstalacionesProjectDetail.tsx
Shows installation summary and customer contact links; loaded project item lines appear En camino, and permitted advance invokes installed using project/item identity. Quantity is displayed but command remains item-line scoped. Job panel receives separate manage and closeout flags.

Missing proof: Quantity>1 per-unit behavior, rejected transitions, visit integration and authoritative closeout require runtime proof.

Evidence: packages/ui/src/production/InstalacionesProjectDetail.tsx:47–70, packages/ui/src/production/InstalacionesProjectDetail.tsx:133–184

## packages/ui/src/production/InstallationJobPanel.tsx
Derives visit/issue/punch/closeout views; gates actions by canManage/canCloseout and domain-derived checks, requires resolution notes/signoff name. Void optional callbacks are followed immediately by clearing local drafts/forms; no child pending/commit acknowledgement is represented.

Missing proof: Deferred/rejected callback tests must establish draft retention and feedback; authoritative transitions/audit and concurrency are not proved by child gates.

Evidence: packages/ui/src/production/InstallationJobPanel.tsx:59–86, packages/ui/src/production/InstallationJobPanel.tsx:282–297, packages/ui/src/production/InstallationJobPanel.tsx:431–441, packages/ui/src/production/InstallationJobPanel.tsx:547–560, packages/ui/src/production/InstallationJobPanel.tsx:582–621

## packages/ui/src/production/ProductionBoardView.tsx
Separates supplied exact CutPlanSheet from legacy simplePack preview; cnc-nesting suppresses guillotine decorations. Exact metrics use sheet yield; optional estimated fill sums source areas and caps at100. Legacy approximation remains linked to existing FM-04, not a machine plan.

Missing proof: FM-04 remains existing finding; nesting/guillotine golden rendering, invalid dimensions and actual machine import/readback remain unproved.

Evidence: packages/ui/src/production/ProductionBoardView.tsx:51–91, packages/ui/src/production/ProductionBoardView.tsx:95–117

## packages/ui/src/production/ProductionElevationPreview.tsx
Draws wall elevation from supplied units using offset/bottomZ/dimensions, labels wall and width, distinguishes wall/floor fills and empty wall. Unit key is itemId plus instanceIndex; no editing or persistence.

Missing proof: SVG legibility at narrow widths, accessible unit detail and parity with exported elevations remain unverified.

Evidence: packages/ui/src/production/ProductionElevationPreview.tsx:15–40, packages/ui/src/production/ProductionElevationPreview.tsx:66–104

## packages/ui/src/production/ProductionIslandPreview.tsx
Draws separate free-placement island elevation with category theme, floor/base clearance, dimensions and space label; includes X/Y/yaw metadata without attempting wall projection.

Missing proof: Preview/PDF parity, accurate elevations for physical assembly, zoom/contrast and screen-reader output remain unverified.

Evidence: packages/ui/src/production/ProductionIslandPreview.tsx:24–55, packages/ui/src/production/ProductionIslandPreview.tsx:114–129

## packages/ui/src/production/ProductionOrderDispatchPanel.tsx
Scan resolves a module payload itemId or first code/name label match; invokes loaded or packaged transition and immediately emits success text/sound without awaiting callback. Disabling auto-loaded still writes packaged. Cards and load/release summary are item-floor-status based, not independent package mutation.

Missing proof: Static optimistic-success gap needs deferred/rejected callback proof; duplicate QR, wrong-project wrapper behavior and per-package authoritative load/release remain unproved.

Evidence: packages/ui/src/production/ProductionOrderDispatchPanel.tsx:112–199, packages/ui/src/production/ProductionOrderDispatchPanel.tsx:260–301, packages/ui/src/production/ProductionOrderDispatchPanel.tsx:448–475, packages/ui/src/production/ProductionOrderDispatchPanel.tsx:500–544

## packages/ui/src/production/ProductionOrderDocumentsPanel.tsx
Renders document catalog availability/reason/action text; disables downloads while busy, unavailable or lacking callback and invokes supplied handler. Pack can become the primary action; component does not generate or authorize documents.

Missing proof: Exact release/revision ownership, download failure, duplicate-click recovery, PDF/DXF/CNC/assembly artifact content remain unverified.

Evidence: packages/ui/src/production/ProductionOrderDocumentsPanel.tsx:20–118

## packages/ui/src/production/ProductionOrderHardwarePanel.tsx
Distinguishes failed hardware rows (null) from empty list, gates export by data/busy, renders quantity and optional cost column controlled by hideCosts. This is read-only requirements display, not picking or stock mutation.

Missing proof: Cost authorization upstream, requirements-to-stock reconciliation, export parity and failure recovery remain unverified.

Evidence: packages/ui/src/production/ProductionOrderHardwarePanel.tsx:20–120

## packages/ui/src/production/ProductionOrderModulesPanel.tsx
Builds read-only module rows and searches identifiers/placement; line-keyed floor-status dropdown is shown only with capability and callback, but exposes every ITEM_FLOOR_STATUS rather than locally constrained next transitions.

Missing proof: Server rejection/rollback, pending-state feedback and qty>1 physical unit status cannot be inferred from this line-level dropdown.

Evidence: packages/ui/src/production/ProductionOrderModulesPanel.tsx:39–55, packages/ui/src/production/ProductionOrderModulesPanel.tsx:108–125, packages/ui/src/production/ProductionOrderModulesPanel.tsx:143–166

## packages/ui/src/production/ProjectFloorProgressStrip.tsx
Delegates progress to buildProjectFloorSummary; no-items returns null, strip has summarized accessible label and decorative stage list, chip reports active sector or installed. No progress mutations or independent metrics computation.

Missing proof: Underlying event/quantity truth and browser assistive output are not proved by presentation source.

Evidence: packages/ui/src/production/ProjectFloorProgressStrip.tsx:24–40, packages/ui/src/production/ProjectFloorProgressStrip.tsx:70–106

## packages/ui/src/production/board/ProductionBoardHoverCard.tsx
Null piece hides card; otherwise read-only hover details distinguish saw-cut versus original final measures, grain/rotation and edge sides. Card is absolutely positioned with pointerEvents none and no independent keyboard trigger.

Missing proof: Accessible alternative and viewport collision on small boards need browser review; numeric values are trusted supplied cut-plan fields.

Evidence: packages/ui/src/production/board/ProductionBoardHoverCard.tsx:12–54

## packages/ui/src/production/board/ProductionBoardSvg.tsx
Renders supplied exact piece positions, cut/remnant decorations and separate legacy geometry. Useful remnants require isUseful and area>=0.24. Exact-piece groups wire mouse hover/click but no tabindex or keyboard handler; this is a static keyboard-accessibility gap, not runtime certification.

Missing proof: Keyboard-equivalent piece selection, accessible SVG naming, golden edge orientation and machine accuracy remain unverified.

Evidence: packages/ui/src/production/board/ProductionBoardSvg.tsx:59–105, packages/ui/src/production/board/ProductionBoardSvg.tsx:267–294, packages/ui/src/production/board/ProductionBoardSvg.tsx:374–401

## packages/ui/src/production/hub/ProductionHubResumenTab.tsx
Displays readiness and domain-summarized material areas/edge lengths; missing cut data shows dashes. Ready-to-cut banner trusts readiness.readyToCut while pack export gates packGenerable/busy/callback; no release authority is established here.

Missing proof: Readiness versus exact released revision/machine profile and approved output needs upstream integration proof; this display cannot certify safe cutting.

Evidence: packages/ui/src/production/hub/ProductionHubResumenTab.tsx:118–154, packages/ui/src/production/hub/ProductionHubResumenTab.tsx:186–240, packages/ui/src/production/hub/ProductionHubResumenTab.tsx:243–299

## packages/ui/src/production/labels/LabelPrinterConfigSection.tsx
Controlled printer settings expose allowed size presets,203/300DPI,border and JSON versus URL QR format; host field appears for URL, printer name only with raw bridge. Local setting callbacks do not validate device compatibility.

Missing proof: Persistence, malformed host handling, raw desktop bridge availability and exact printer calibration/readback remain unverified.

Evidence: packages/ui/src/production/labels/LabelPrinterConfigSection.tsx:51–93, packages/ui/src/production/labels/LabelPrinterConfigSection.tsx:109–159

## packages/ui/src/production/labels/ModuleLabelsTabContent.tsx
Filters bulto labels and builds QR using unit/package fields and production revision override; cancellation suppresses stale QR completion. ZPL uses filtered labels. Raw print awaits bridge result and reports sent versus error, but has no in-flight button lock. Preview rows are mouse-click only.

Missing proof: Repeated raw-print clicks, keyboard row selection, QR failure visibility and actual printed label/readback are unverified; bridge acceptance is not physical print proof.

Evidence: packages/ui/src/production/labels/ModuleLabelsTabContent.tsx:81–130, packages/ui/src/production/labels/ModuleLabelsTabContent.tsx:132–154, packages/ui/src/production/labels/ModuleLabelsTabContent.tsx:156–205, packages/ui/src/production/labels/ModuleLabelsTabContent.tsx:341–385, packages/ui/src/production/labels/ModuleLabelsTabContent.tsx:410–420

## packages/ui/src/production/labels/PieceLabelsTabContent.tsx
Filters piece labels by text/module/material, optionally expands quantity into copies (minimum1,floor quantity), generates cancellable QR preview and ZPL. Raw print awaits result with status/alert; buttons lack print-in-flight lock and preview rows wire only mouse clicks.

Missing proof: Quantity normalization/identity, double print, keyboard preview selection and exact QR/PDF/ZPL/printer parity need tests; existing FM-03 drilling proof does not prove labels.

Evidence: packages/ui/src/production/labels/PieceLabelsTabContent.tsx:50–54, packages/ui/src/production/labels/PieceLabelsTabContent.tsx:89–112, packages/ui/src/production/labels/PieceLabelsTabContent.tsx:115–152, packages/ui/src/production/labels/PieceLabelsTabContent.tsx:180–220, packages/ui/src/production/labels/PieceLabelsTabContent.tsx:436–475, packages/ui/src/production/labels/PieceLabelsTabContent.tsx:500–510

## packages/ui/src/production/manager/ProductionManagerActiveJobs.tsx
Read-only activity rows display operator/project/module/machine and formatted supplied duration. Empty jobs hide the section; despite real-time header comment this component owns no refresh clock/subscription.

Missing proof: Upstream refresh cadence, stale/failed fetch distinction and duration correctness remain unverified.

Evidence: packages/ui/src/production/manager/ProductionManagerActiveJobs.tsx:9–40, packages/ui/src/production/manager/ProductionManagerActiveJobs.tsx:48–60

## packages/ui/src/production/manager/ProductionManagerProjectsTable.tsx
Displays supplied project summaries, prioritizes open-order callback over open-project, renders named progressbar and sector counts. Empty list presents no-project state; no local loading/error distinction or business mutation.

Missing proof: Upstream permission filtering, empty-versus-error distinction, totalItems truth and navigation integration need proof.

Evidence: packages/ui/src/production/manager/ProductionManagerProjectsTable.tsx:30–65, packages/ui/src/production/manager/ProductionManagerProjectsTable.tsx:76–116, packages/ui/src/production/manager/ProductionManagerProjectsTable.tsx:146–166

## packages/ui/src/production/manager/ProductionManagerSectorsGrid.tsx
Sector buttons report aria-pressed selection and callback, active-operator/queue counts; optional metric panel displays supplied completed/damaged daily totals. Icon fallback covers unknown sector without creating a workflow state.

Missing proof: Metrics actual-versus-proxy provenance, day timezone boundaries and refresh/error behavior remain upstream and unverified.

Evidence: packages/ui/src/production/manager/ProductionManagerSectorsGrid.tsx:22–38, packages/ui/src/production/manager/ProductionManagerSectorsGrid.tsx:64–91, packages/ui/src/production/manager/ProductionManagerSectorsGrid.tsx:95–124
