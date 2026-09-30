# ODD — #944 [P1][LIB-5] Web release lifecycle, version catalog and overlay rebase/conflict management in React

**Issue**: https://github.com/tiagofur/muebleria/issues/944  
**Title**: [P1][LIB-5] Web release lifecycle, version catalog and overlay rebase/conflict management in React  
**Status**: COMPLETED  
**Lane**: ODD  
**Base**: `origin/main` @ `ac546687`  
**Branch**: `feat/944-web-library-releases`  
**Writer**: tiagofur

---

## Outcome

Expose an authoritative HTTP API and React UI in Granete Web so factory managers can audit available manufacturing library releases, compare active overlay base with upstream Granete Standard, trigger atomic 3-way rebases, and inspect and resolve overlay conflicts visually with full auditability and multi-tenant isolation:

1. **Backend Go — Standard Releases Catalog API**:
   - `GET /api/manufacturing-libraries/standard/releases` lists all published releases for Granete Standard in reverse chronological order.
   - Synchronized OpenAPI spec (`getStandardReleases`) and generated TypeScript client with 0 drift.
2. **Frontend React — Version Status & Upstream Update**:
   - Visual indicator showing current active base release vs. latest published Granete Standard release.
   - Action to trigger `rebaseLibraryOverlay` when a newer upstream release is available.
3. **Frontend React — Visual Conflict Review & Resolution**:
   - Lists pending conflicts from `listLibraryOverlayConflicts`.
   - Compares custom factory value against upstream proposed value.
   - Actions to resolve (`keep_custom` / `adopt_upstream`) via `resolveLibraryOverlayConflict` until overlay returns to `active`.
4. **Frontend React — Release History & Changelog**:
   - Chronological list of published versions with dates and release notes.

---

## Acceptance Criteria (from issue #944)

- [x] Endpoint `GET /api/manufacturing-libraries/standard/releases` implementado y cubierto con tests en Go.
- [x] OpenAPI actualizado y sincronizado; types y cliente TS en `packages/storage` limpios (typecheck PASS, 0 drift).
- [x] UI en React lista el historial de releases de Granete Standard y su changelog.
- [x] UI alerta cuando el overlay activo está atrasado respecto al último release de Standard.
- [x] UI permite ejecutar rebase a un nuevo release y refleja el estado resultante (`active` o `conflict`).
- [x] UI presenta conflictos pendientes con detalle y permite resolverlos con `keep_custom` o `adopt_upstream`.
- [x] Pruebas unitarias y de integración de componentes React (`useFactoryConstructionPolicy.test.ts` & `ConstructionSettingsSection.test.tsx`).
- [x] Verificación completa: `go test ./internal/api` PASS, `@granete/storage` 245/245 PASS, `@granete/ui` 7/7 PASS, `@granete/web` 4/4 PASS, `pnpm run typecheck` en los 7 paquetes PASS, `factory_preflight.py` OK.

---

## Negative Proof (Review must fail if)

- A tenant can list or rebase overlays belonging to another organization.
- Rebase silently discards custom values without flagging conflicts.
- Resolving a conflict mutates published historical library releases.
- A non-admin user can trigger rebases or resolve conflicts without appropriate permissions.
- UI shows generic unhandled error or crashes when no overlay or no releases exist.
- Historical designs or production releases are retargeted after a library update.

---

## Explicit Exclusions

- Universal visual library/script editor.
- Modifying the Go 3-way rebase domain engine logic (#775 is already proven).
- Factory-to-store commercial publication (#454).
- Batch historical project migration guessing customer intent.

---

## Execution Plan

### T1 — Backend Go: Release Catalog Storage & HTTP Handler
- Add `GetPublishedReleases(ctx context.Context, libraryID uuid.UUID) ([]*domain.LibraryRelease, error)` to `PostgresStore`.
- Add `HandleStandardLibraryReleases` in `backend-go/internal/api/manufacturing_library.go`.
- Register route `GET /api/manufacturing-libraries/standard/releases` in `backend-go/internal/api/routes.go`.
- Add unit tests in `manufacturing_library_test.go`.

### T2 — OpenAPI & TypeScript Storage Client
- Add endpoint `/manufacturing-libraries/standard/releases` to `contracts/openapi/granete-api.v1.yaml`.
- Generate TypeScript client in `packages/storage/src/openapi/generated/client.ts`.
- Verify `python3 scripts/check_openapi_drift.py` passes (0 drift).
- Add helper methods in `packages/storage/src/apiClient.ts` with unit tests.

### T3 — Frontend Domain Hook: `useLibraryReleases` & Rebase Flow
- Implement hook in `apps/web/src/` to fetch releases catalog, detect update availability, execute rebase, list conflicts, and resolve conflicts.
- Unit tests with mock responses covering success, conflict state, and resolution.

### T4 — Frontend UI: Release Catalog, Update Banner & Conflict Modal/Drawer
- Upstream status badge & update button in `SettingsScreen` (Fabricación / Biblioteca de Manufactura).
- Conflict resolution interface showing path, custom value, upstream value, and keep/adopt controls.
- Release history list with changelogs.
- Localized in Spanish, accessible, resilient to loading/error/empty states.

### T5 — Unit & Component Tests
- React component tests in `apps/web/src/`.
- Full workspace typecheck (`pnpm run typecheck`).

### T6 — Verification & Browser E2E Gate
- Integration proof against ephemeral PostgreSQL 16 container.
- Clean preflight report.
