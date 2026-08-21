# Sesión activa: Issue #300 — Operational Core O1: Lifecycle, approvals, Production Release y Change Orders (OC-010..OC-024)

**Fecha:** 2026-08-21  
**Objetivo:** Construir la columna vertebral operacional del Project/Job según `docs/operational-core-v1.md` (OC-010..OC-024) y `docs/project-lifecycle.md`.

## Plan por fases
- [x] Planificación y aprobación del plan (6 fases)
- [x] **Fase 1:** Dominio Base — Event Log Append-Only, CommercialStatus, ProjectStage y Anticipo Real (OC-010..013)
- [x] **Fase 2:** Persistencia, Mappers y Paridad Backend Go (Eventos y Estado Comercial)
- [x] **Fase 3:** Revisiones de Diseño, Aprobaciones y Production Release Formal (OC-020..022)
- [x] **Fase 4:** Detección de Staleness Uniforme y Change Orders (OC-023..024)
- [x] **Fase 5:** Integración UI, Dashboards y Modales
- [x] **Fase 6:** Verificación Global, Docs Reconcile y Ledger

## Estado actual
- **Fase 1 completada:** Eventos append-only, estados comerciales (`draft`, `sent`, `won`, `lost`, `expired`, `cancelled`), cálculo de `ProjectStage`, registro de anticipos y KPIs de ciclo de vida en `packages/domain/src/projectLifecycle.ts`.
- **Fase 2 completada:**
  - Migración Postgres `000066_project_events_and_commercial_status` (up/down).
  - Backend Go: dominio, storage (`ListProjectEvents`, `InsertProjectEvent`, `upsertProjectEventsTx`, `commercial_status`), endpoints HTTP (`GET/POST /api/projects/{id}/events`), tests unitarios Go 100% pasando.
  - TypeScript Storage: mappers `projectEventToApi`, `projectEventFromApi`, `commercial_status` roundtrip en `packages/storage`.
- **Fase 3 completada:**
  - Migración Postgres `000067_project_revisions_approvals_and_release` (up/down).
  - Go Backend: dominio `DesignRevision`, `Approval`, `ProductionRelease`, storage CRUD y serialización JSONB.
  - TS Mappers: serialización bidireccional y tests unitarios en `packages/storage`.
- **Fase 4 completada:**
  - Migración Postgres `000068_project_change_orders` (up/down).
  - Dominio TS: `getProjectStalenessReport`, `isProjectStaleForProduction`, `createChangeOrder`, `submitChangeOrder`, `approveChangeOrder`, `rejectChangeOrder`.
  - Go Backend y TS Mappers: soporte completo para `ChangeOrder` y roundtrip tests.
- **Fase 5 completada:**
  - UI Components: `ProjectStalenessBanner`, `ProductionReleaseModal` (6 gates formales), `ChangeOrderModal`, `LifecyclePanel`.
  - Integración en `ProjectDetailView`, `ProjectsScreen`, `projectStore` y `ShellView`.
- **Fase 6 completada:**
  - `pnpm test` pasando al 100% (772 tests en domain, 1151 tests en UI, 140 en storage, etc.).
  - `pnpm typecheck` pasando al 100% en todos los paquetes del monorepo.
  - `go test -v ./...` pasando al 100% en `backend-go`.
  - Actualizado `feature_list.json` con la feature `F135`.

## Revisión de pares (2026-08-21, sesión posterior)

Verdict: implementación sólida; se detectaron y corrigieron 5 gaps (4 mejoras
propuestas en la revisión del plan + 1 fix funcional):

1. **Paridad TS↔Go con contract fixture** (regla dura de AGENTS.md):
   - `contracts/projectEventTypes.json` (convención de `contracts/roles.json`).
   - TS: `PROJECT_EVENT_TYPES` + `isProjectEventType` exportados.
   - Go: `IsValidProjectEventType`; POST /events rechaza tipos inventados (400).
   - Tests de paridad en ambos lados (`projectLifecycle.test.ts`,
     `backend-go/internal/domain/projectEventsParity_test.go`).
2. **RBAC + enforcement en el event log** (`roleCanAppendProjectEvent` TS↔Go):
   - Política por categoría: comercial (vendedor/gerente_ventas) posee
     quote/deposit/customer_approval; ingeniería posee gates técnicos y
     co-firma `production_released`; planta posee hitos físicos; decisiones de
     CO y closeout son de gerentes/admin.
   - Enforcement server-side en `POST /api/projects/{id}/events` (403) y en
     eventos NUEVOS que llegan vía `PUT /api/projects/{id}` (dual-write):
     `authorizeProjectEventAppends` — reenviar el log existente nunca se
     rechaza.
3. **KPIs honestos (OC-006):** duraciones apoyadas en eventos backfilled ahora
   reportan `origin: 'proxy'` (antes siempre `'actual'`).
4. **Semántica CO vs producción codificada en test:** aprobar una ChangeOrder
   post-release NO re-libera: el proyecto queda stale hasta una nueva
   `ProductionRelease` explícita contra la nueva revisión.
5. **Fix funcional OC-013:** no existía UI para registrar el anticipo, por lo
   que el gate `deposit_received` (requerido por defecto) hacía imposible
   liberar a producción desde la app. Agregado: store action `recordDeposit`,
   sección "Anticipo" en `LifecyclePanel` (con tests), wiring en
   `ProjectDetailView`/`ShellView` y CSS con tokens.

**Verificación post-revisión:** `pnpm test` (domain 780, ui 1155, web 298,
storage 140), `pnpm typecheck` y `go test ./...` en verde.



