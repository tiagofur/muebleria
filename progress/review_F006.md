# Review — feature F006

**Veredicto:** APPROVED  
**Feature:** F006 — ui_catalogs  
**Reviewer:** reviewer agent  
**Date:** 2026-07-15  
**Handoff:** `progress/impl_F006.md`

## Acceptance criteria → evidence

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | CRUD completo × 3 catálogos (CAT-01..03) | PASS | Controlled screens: `MaterialsCatalog.tsx`, `EdgesCatalog.tsx`, `HardwareCatalog.tsx` — create/edit form + `onCreate` / `onUpdate` / `onDeactivate` / `onReactivate`. Shell wiring in `apps/web/src/App.tsx` builds domain entities (`MaterialBoard` / `EdgeBand` / `Hardware`) and soft-sets `active`. Min fields: materials code/name/costPerM2 (+ thickness, grain, waste); edges code/name/costPerMl; hardware code/name/unit/costPerUnit. |
| 2 | Soft-delete; inactive hidden in pickers (CAT-05) | PASS | No hard delete UI — only Desactivar/Reactivar. Lists: `filterCatalogItems` hides inactive by default (`catalogHelpers.ts` L59–68); toggle “Mostrar inactivos” on all 3 screens. Pickers: `CatalogPicker` + `filterActiveForPicker` (`CatalogPicker.tsx` L37; helpers L74–82). Tests: `catalogHelpers.test.ts` L51–72; `App.test.ts` L34–48. |
| 3 | Validación código único en cliente (CAT-04) | PASS | `validateUniqueCode` / `findActiveCodeConflict` — case-insensitive, active-only, exclude self on edit (`catalogHelpers.ts` L24–57). Called in `validate()` of all 3 screens before save. Tests: `catalogHelpers.test.ts` L24–49; seed conflict in `App.test.ts` L28–32. |
| 4 | Datos semilla visibles al abrir (CAT-06) | PASS | `App` initial state: `useState(() => createSeedWorkspace())` (`App.tsx` L39). Seed from `@muebles/storage/seed` → plantilla catalog (`seed.ts` L15–20). Asserts `TAB-ARA-BLA`, `HER-BIS-CL`, non-empty materials/edges/hardware (`App.test.ts` L16–26). |

### PRD CAT-01..06 detail

| ID | Result | Notes |
|----|--------|-------|
| CAT-01 | PASS | Material ABM + cost/m² field; soft-deactivate |
| CAT-02 | PASS | Edge ABM + cost/ML |
| CAT-03 | PASS | Hardware ABM + unit + cost unitario |
| CAT-04 | PASS | Active codes unique per list (same type); inactive codes reusable |
| CAT-05 | PASS | Soft-delete only; list/picker hide inactive by default |
| CAT-06 | PASS | Plantilla seed via `createSeedWorkspace` / domain fixtures |

## Architecture boundaries (C3)

| Check | Result |
|-------|--------|
| UI no fórmulas de costo / m² / ML | PASS — helpers only uniqueness + filters + field validators; cost values are form fields/display, never computed (`packages/ui/src/catalogs/*`; no `calc*` / engine imports) |
| UI no accede a `fs` / electron / xlsx | PASS — deps: `@muebles/domain`, `react` only (`packages/ui/package.json`); screens import `type` from domain only |
| Apps = shell delgado | PASS — `App.tsx` owns arrays + maps drafts → entities; no BOM/quote formulas |
| Browser-safe seed path | PASS — `@muebles/storage/seed` export avoids Node `fs` adapter in Vite bundle (`packages/storage/package.json` `./seed`; web imports seed only) |
| Domain purity untouched | PASS — F006 did not add domain calc logic for catalogs UI |
| Sin `console.log` debug | PASS — none in `packages/ui` or `apps/web` production sources |

## Conventions

- Module headers + camelCase files (`catalogHelpers.ts`, `CatalogTable.tsx`, screens PascalCase components) — PASS  
- Controlled immutability in shell: spread + `map` for updates (`App.tsx`) — PASS  
- Spanish UI messages for validation/errors — PASS  
- Colocated helper tests (`catalogHelpers.test.ts`); package surface smoke (`index.test.ts`) — PASS  
- Vitest node env for pure helpers — PASS for this slice  

## Verification (docs/verification.md)

| Level | Result |
|-------|--------|
| Nivel 1 domain | PASS — 29/29 (via `./init.sh`) |
| Nivel 2 ui | PASS — 14/14 (`catalogHelpers` + export surface) |
| Nivel 2 web | PASS — 4/4 (seed CAT-06, CAT-04 helper, CAT-05 picker helper, package resolve) |
| Nivel 3 monorepo | PASS — `./init.sh` exit 0, all workspaces green |
| Typecheck / build | PASS — `@muebles/ui` + `@muebles/web` typecheck; Vite web production build OK |
| Golden / excel / storage | N/A for F006 logic; monorepo still green |

## Commands executed (reviewer)

```text
./init.sh                              # exit 0 — [OK] Entorno listo; 15 features, 1 in_progress (F006)
pnpm --filter @muebles/ui typecheck    # ok
pnpm --filter @muebles/web typecheck   # ok
pnpm --filter @muebles/web build       # ok (Vite production)
# included in init.sh:
#   pnpm --filter @muebles/ui test     → 14 passed
#   pnpm --filter @muebles/web test    → 4 passed
#   pnpm test (all workspaces)         → green
```

## Checkpoints

### C1 — El harness está completo
- [x] Archivos base: `AGENTS.md`, `init.sh`, `feature_list.json`, `progress/current.md`, `CHECKPOINTS.md`
- [x] Docs: `docs/prd.md`, `docs/architecture.md`, `docs/conventions.md`, `docs/verification.md`
- [x] Skills: leader / implementer / reviewer under `.agents/skills/`
- [x] `./init.sh` exit 0

### C2 — El estado es coherente
- [x] Como mucho una feature `in_progress` (solo F006)
- [x] Features `done` (F001–F005) con monorepo tests green
- [x] `progress/current.md` describe sesión F006 activa (awaiting review)

### C3 — El código respeta la arquitectura
- [x] `packages/domain` no importa react, electron, fs, ni xlsx (no violado por F006)
- [x] `packages/ui` no implementa fórmulas de costo ni accede a fs
- [x] `packages/excel` no importa react ni electron (no tocado en F006)
- [x] Errores de dominio: N/A en UI (validación cliente devuelve strings de form; no propaga stacks)
- [x] Sin `console.log` de debug en sources UI/web de producción

### C4 — La verificación es real
- [x] `pnpm --filter @muebles/domain test` 100%
- [x] UI helpers CAT-04/CAT-05 + seed CAT-06 asserts en web tests
- [x] Export fixture / golden motor — N/A scope F006; monorepo still green
- [x] Storage tempdir — N/A scope F006; monorepo still green

### C5 — Cierre de sesión (post-approve, owner: leader)
- [x] Sin artefactos sospechosos en sources revisados (`packages/ui/src/catalogs/*`, `apps/web/src/*`, seed export)
- [ ] `progress/history.md` entrada de **esta** sesión — pendiente al cerrar (leader)
- [ ] Feature en estado final correcto en `feature_list.json` — sigue `in_progress` (correcto pre-approve; leader marca `done`)
- [ ] `progress/current.md` limpio — pendiente al archivar sesión (leader)

> C5 open boxes are **session-close duties for the leader after approval**, not F006 defects. Reviewer does not mark `done` or close the session.

## Residual notes (non-blocking)

1. **No DOM / React Testing Library coverage** — screens and `App` are not rendered in tests (`environment: 'node'`; no `@testing-library/react`). Critical pure rules (unique code, filters) are unit-tested; full CRUD interaction is code-reviewed only. Acceptable for F006 given `docs/verification.md` (“si hay tests de componente”). Future UI features may add RTL smoke if regressions appear.
2. **`App.test.ts` does not import `App`** — it verifies seed + helper contracts the shell relies on, not React mount. Wiring in `App.tsx` is consistent with those contracts.
3. **In-memory web persistence only** — reload re-seeds; JSON file adapter remains Node/desktop path. Documented in handoff; out of F006 scope.
4. **Saved codes are trimmed, not uppercased** — uniqueness is case-insensitive via `normalizeCode`, so CAT-04 holds; stored display may keep mixed case until a later normalize-on-save polish.
5. **`CatalogPicker` not mounted in web shell yet** — correct for catalogs-only slice; F007+ will consume it. Behaviour is unit-tested via `filterActiveForPicker`.

## Cambios requeridos

Ninguno.

## Leader next steps (not reviewer)

1. Marcar F006 `done` en `feature_list.json`.
2. Archivar sesión en `progress/history.md` y limpiar/actualizar `progress/current.md`.
3. Tomar F007 (`ui_option_groups`) como siguiente feature pending.
