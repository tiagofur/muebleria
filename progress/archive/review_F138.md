# Review — feature F138 (issue #302, OC-050..054 + OC-060..062)

**Veredicto:** APPROVED (tras aplicar los 3 defects de la primera pasada)
**Rama:** `feat/f138-mrp-qc` · primera pasada: CHANGES_REQUESTED (3 defects
menores + 2 recomendaciones) — todos aplicados y suites re-verificadas en verde

## Checkpoints

- C1: [x] Harness completo; `./init.sh` exit 0 al inicio de la sesión; suites re-verificadas verde
- C2: [x] Una sola feature in_progress (F138); progress/current.md describe la sesión activa
- C3: [x] Boundaries respetados: domain sin react/fs/xlsx (imports locales only); UI sin
  fórmulas (los paneles consumen vistas puras resueltas por el shell
  `materialPlanningCardView`/`qualityPanelView`, mismo patrón que
  `installationJobView`); storage sólo mapea; errores de dominio son
  `ValidationError` (subclase de DomainError); sin console.log nuevos
- C4: [x] Verificación real: domain 875 (+39) · storage 147 (+4 roundtrips) ·
  ui 1186 (+13) · web 301 · go test ./... (parity fixtures + gates 409 + RBAC
  403 + override auditado + QC gate block/pasa + scrap físico) · typecheck OK
- C5: [x] Sin archivos sospechosos; feature_list con estado correcto
  (in_progress hasta cierre); history pendiente al cierre (post-fix)

## Paridad TS↔Go (regla dura AGENTS.md)

- [x] `contracts/materialPlanning.json` + `contracts/qualityStatuses.json`
  consumidos por tests TS (domain) y Go (`materialPlanningParity_test.go`,
  `qualityParity_test.go`) — vocabularios, transiciones y códigos de gates
- [x] Lógica espejada con tests equivalentes: gates OC-054 (TS/Go), coverage +
  caps de reserva (TS/Go), QC gate (TS/Go), `roleCanSuperviseFloor` ahora
  existe en ambos (nuevo en TS, paridad con Go)
- [x] Fix de paridad incluido: rbac.go no tenía `quality_issue_reported`/
  `rework_started` en la matriz de eventos (TS sí) — corregido

## Diseño UI/UX (design.md §8 + operational-ux §12)

- D1: [x] Copy/§7.2 (FIX aplicado) — `MaterialPlanningPanel` muestra el `materialId` crudo
  (`Herrajes · hw-1`) en la tabla de cobertura; el catálogo de labels ya
  existe (`stockLabels` en la misma pantalla). "La UI nunca muestra ids de DB"
  → pasar labels al panel
- D2: [x] Tokens only en CSS nuevo (`.purch-plan__*`, `.quality-panel__*`);
  badges del vocabulario único; iconos Lucide strokeWidth 1.5; override NO es
  primaria (operational-ux §8 ✓)
- D3: [x] Server-truth (FIX aplicado) — `runMaterialPlanningAction` aplica el proyecto LOCAL
  tras el éxito del endpoint en vez del planning devuelto por el server
  (timestamps/ids derivan hasta el próximo GET; diverge del patrón F137 que
  aplicaba lo confirmado por el server)
- D4: [x] Gates explican cómo resolverse (details accionables, operational-ux
  §2.4 ✓); shortfall visible como evidencia y TO convertible en trabajo (§2.5 ✓)
- D5: [x] A11y: tabla con aria-label + scope, checkboxes con label, override
  input con label for, botones con texto
- D6: [x] Una primaria por sub-contexto: la card conserva su primaria por tab
  (Marcar despachado) y el panel expandido tiene UNA primaria (Liberar/Derivar)
  — el panel es el sub-contexto de planificación, igual que InstallationJobPanel
- D7: [x] Copy/§7.2 (FIX aplicado) — `QualityPanel` muestra ids crudos en el meta de
  issues (`· unidad p1_i1_u1`) y como placeholder del campo pieza; usar labels
  humanos (Unidad N / partCode)

## Cambios requeridos (aplicados)

1. **D1 — APLICADO** — `MaterialPlanningPanel.tsx` acepta `labelsByMaterial`
   (wired a `stockLabels` desde PurchasingScreen): la tabla de cobertura
   muestra `Herrajes · <label de catálogo>`, nunca el id crudo.
2. **D3 — APLICADO** — `AppContent.runMaterialPlanningAction` en modo API
   aplica el planning devuelto por el endpoint (`applyServer`: planning del
   server + sello materialsRelease confirmado); el proyecto local queda sólo
   para el path offline/guest.
3. **D7 — APLICADO** — `QualityPanel`: meta de issues con labels humanos
   (Unidad N vía unitGates, pieza por partCode vía `partLabelByInstance`) y el
   campo de pieza del rework pasó de input de id crudo a **select** con
   opciones `partCode · U<idx> · descripción` (`partOptions` del view).

## Recomendaciones (no bloqueantes)

- R1: La cobertura de tableros hereda `estimatedSheets` (estimación de
  planchas) — la tabla del panel podría marcar `≈` en la línea de tableros
  (data truth §6 operational-ux). Hoy la pantalla ya rotula "Planchas
  estimadas" en su sección.
- R2: `consumePlannedMaterials` (dominio) queda sin cablear al picking
  (`purchasingStore.togglePick`) — registrar como deuda/follow-up explícito
  (ya anotado en progress/current.md).

## Nota de proceso

Los 3 defects eran menores (copy/consistencia), sin impacto en dominio,
persistencia ni autoridad de servidor. Aplicados y re-verificados:

- ui **1186** (paneles 13 OK) · web **301** · domain **875** · storage **147**
- `go test ./...` OK (8 paquetes) · `pnpm typecheck` OK

R1/R2 saldadas en el mismo PR (commit "fix(ops): F138 deuda de review"):
- **R2 aplicado** — `POST /api/projects/{id}/materials/consume` (Go +
  `ConsumePlannedMaterials` espejo de `consumePlannedMaterials`), repo
  `consumeMaterials`, hook `onDespachado` en `togglePick` y consumo en
  `handleTogglePick` (server planning en modo API, acción pura offline).
  Semántica corregida en ambos lados: reservas `consumed` siguen cubriendo la
  línea (cobertura + gates OC-054) sin reducir la disponibilidad del depósito;
  desmarcar revierte stock pero jamás revoca el consumo (el registro es
  historia). Tests espejo TS/Go + handler test.
- **R1 aplicado** — la cobertura marca `≈` + title "Planchas estimadas del
  BOM liberado" en las líneas de tableros (data truth §6 operational-ux).
