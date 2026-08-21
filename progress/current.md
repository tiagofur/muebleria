# Sesión activa: Issue #301 — Operational Core O2: Producción física (OC-030..OC-034)

**Fecha:** 2026-08-21
**Objetivo:** Migrar el seguimiento físico a la granularidad real del taller según `docs/production-flow-v2.md` y `docs/operational-core-v1.md`.

## Estado

F136 completa en tres pasadas: (1) implementación inicial de fases, (2) revisión
con correcciones duras (concurrencia, RBAC/audit, revisión stale, transiciones,
split-brain), (3) **esta sesión**: deuda documentada.

## Esta sesión — deuda resuelta (#301)

1. **Generación server-side (`PUT /api/projects/{id}/part-executions`):**
   persiste las instancias derivadas del BOM (resolución en TS) tras validar
   server-side: líneas existentes, una unidad por unidad de cantidad, rutas que
   empiezan en cut, revisión = liberada. Regenerar sobre avance existente exige
   `force` supervisor y audita el reset con floor events. Snapshot de storage
   extendido con cantidades de línea.
2. **Escáner móvil migrado a los endpoints físicos:** QR de pieza (`pId`)
   completa la operación actual (server resuelve `currentOperationIndex`; gate
   RBAC por "alguna estación de piezas asignada"); QR de unidad/bulto (`uId`)
   avanza la unidad por el gate de armado server-side; fallback legacy para
   etiquetas v1/v2 sin pId/uId; cola offline re-enrutada en sync. ScannerScreen
   muestra la resolución física con botón Avanzar.
3. **Dashboards por pieza:** `buildProjectFloorSummary` entra en modo físico
   cuando hay ejecución generada — Corte/Enchape cuentan piezas (piezas en CNC
   = cola de Enchape, en tránsito), Armado+ cuenta unidades. PlantBoard,
   ProgressStrip y ManagerDashboard heredan el conteo honesto sin cambios.
   `countMode`/`totalParts`/`totalUnits` expuestos.
4. **Pantalla de armado por unidad:** `physicalStationQueue` (dominio) +
   FabricScreen renderiza en modo físico filas por pieza (código, U#, dims,
   operación, retrabajo) y por unidad ("Unidad 2 de 3", readiness, faltantes
   con su estación vía `describeMissingPieces`, bultos). Callbacks opcionales
   `onAdvancePart`/`onAdvanceUnit`; sin ellos no se muestra botón (el legacy
   daría 409). Batch legacy deshabilitado sobre filas físicas.
5. **Identidad de bulto:** clasificación honesta en el parser QR (target
   `package` por multiplicidad bulto/tot>1); `package_count` se registra en la
   unidad al entrar a `packaged` (endpoint + cliente + escáner envía
   totalPackages).
6. **Costing de rework (OC-061):** `material_cost`/`labor_minutes` validados y
   registrados en el payload de `quality_issue_reported`/`rework_started`
   (consultables para job costing); cliente `reworkPart` extendido.

## Deuda restante (siguiente sesión)

- **Wiring del shell web:** cablear `onAdvancePart`/`onAdvanceUnit` desde
  AppContent → ShellView → FabricScreen a `apiWorkspaceRepository` (hoy las
  filas físicas se muestran sin botón de avance en web; móvil sí avanza).
- **Disparar la generación:** invocar `generatePartExecutions` al liberar
  producción (o al abrir la estación) desde el flujo de release web.
- **Dashboard de WC vs physical:** ProductionQueueScreen móvil sigue
  listando proyectos; puede sumar conteos físicos vía `part-executions`.

## Verificación (evidencia de esta sesión)

- `pnpm --filter @muebles/domain test`: **807 tests** OK (colas físicas,
  summary físico, clasificación bulto).
- `pnpm --filter @muebles/ui test`: **1158 tests** OK (filas por pieza/unidad,
  callbacks físicos, faltantes con estación).
- `pnpm --filter mobile test`: **42 tests** OK (routing físico pId/uId/bulto,
  gate 409, offline queue, fallback legacy).
- `pnpm --filter @muebles/storage test`: **141 tests** OK; roundtrip
  supervisorOverride cubierto.
- `go test ./...`: OK — generación (validación/force/audit), scanner mode,
  package_count, costing.
- `pnpm typecheck`: monorepo completo OK.
