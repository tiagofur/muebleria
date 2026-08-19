# Review — feature F015

**Veredicto:** APPROVED  
**Feature:** F015 — duplicate_module_project (Duplicar módulo / proyecto)  
**Reviewer:** reviewer agent  
**Date:** 2026-07-15  
**Handoff:** `progress/impl_F015.md`  
**PRD:** §9.2 MOD-05

## Acceptance criteria → evidence

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | Duplicar módulo crea copia con code sugerido (ej. `MOD-GAB-01-COPY`) (MOD-05) | PASS | `suggestDuplicateCode` → `CODE-COPY` / `COPY2`… (`duplicate.ts` L16–35); `duplicateModule` new id/code + fresh nested ids (`duplicate.ts` L80–100). Domain tests: free COPY, case-insensitive collision, COPY4 skip (`duplicate.test.ts` L97–123, L126–158). UI: row action **Duplicar** when `onDuplicate` set (`ModulesScreen.tsx` L301–308). Shell: `duplicateModuleById` uses `suggestDuplicateCode` + `deepCopyModule` + append (`App.tsx` L646–658, wired L939). |
| 2 | Duplicar proyecto crea copia en draft con todos los ítems y opciones | PASS | `duplicateProject` forces `status: 'draft'`, omits `priceSnapshot`, new item ids, same `moduleId`/`quantity`/`optionChoices` shallow-cloned (`duplicate.ts` L115–138). Test asserts draft, no snapshot, 2 items with choices preserved (`duplicate.test.ts` L172–218). UI: **Duplicar** on project list (`ProjectsScreen.tsx` L295–302). Shell: `duplicateProjectById` (`App.tsx` L716–724, wired L958). |
| 3 | El módulo original no se modifica | PASS | Pure deep copy (no in-place mutation). Module test: `structuredClone` equality of original after dup (`duplicate.test.ts` L127–136). Project dup keeps master `moduleId` and does not touch master module (`duplicate.test.ts` L220–239). Shell appends new entity only (`[...modules, copy]` / `[...projects, copy]`). |

### PRD / independent logic

| Check | Expected | Implementation |
|-------|----------|----------------|
| MOD-05 deep copy module + suggested code | New module entity, new code | `duplicateModule` + `suggestDuplicateCode`; nested boardPart/hardwareLine **ids** regenerated |
| Project duplicate as draft with items/options | Full item list + optionChoices; draft | `status: 'draft'`, no snapshot, choices `{ ...item.optionChoices }` |
| Master modules reusable (MOD-08 spirit) | Project items keep `moduleId` | Explicit; does not clone module masters into project |
| Domain pure / shell thin | Logic in domain; apps wire | Helpers in `packages/domain`; App only ids/timestamps/patch |
| UI no domain formulas | Presentation callbacks only | Optional `onDuplicate?.(id)` + button |

## Architecture boundaries (C3)

| Check | Result |
|-------|--------|
| domain pure (no react/electron/fs/xlsx) | PASS — `duplicate.ts` only types + stdlib (`crypto.randomUUID` optional fallback); no forbidden imports |
| UI no cost formulas / no fs / no xlsx | PASS — buttons invoke shell callback only |
| excel unchanged | PASS — not in scope |
| Apps = thin shells | PASS — `App.tsx` generates ids/timestamps, calls domain, patches workspace |
| DomainError patterns | PASS — pure happy-path helpers; no raw string throws; missing source id → silent no-op (same family as delete-if-missing) |
| Sin `console.log` debug | PASS — none in F015 sources |

## Conventions

- File `duplicate.ts` camelCase; exports `suggestDuplicateCode` / `duplicateModule` / `duplicateProject` — PASS  
- Types `DuplicateModuleOptions` / `DuplicateProjectOptions` PascalCase — PASS  
- Module header comment + `readonly` options — PASS  
- Colocated `duplicate.test.ts` (7 tests, describe per unit) — PASS  
- Exported from `packages/domain/src/index.ts` (types + functions) — PASS  
- Spanish UI label **Duplicar**; `btn btn--small` pattern matches list row actions — PASS  
- Phase 3 feature: `docs/design.md` not required (F016+) — N/A  

## Verification (docs/verification.md)

| Level | Result |
|-------|--------|
| Nivel 1 domain | PASS — 60/60 (includes 7 duplicate tests) |
| Nivel 2 ui | PASS — 56/56 |
| Nivel 2 excel / storage / web / desktop | PASS — 14 / 17 / 30 / 7 |
| Nivel 3 monorepo | PASS — `./init.sh` exit 0 |
| Nivel 4 golden motor | PASS — engine plantilla paths unchanged / green (F015 does not touch engine formulas) |
| Storage tmp | N/A — no storage API change; workspace patch reuses existing path |

## Commands executed (reviewer)

```text
./init.sh
  # exit 0 — domain 60, excel 14, ui 56, storage 17, web 30, desktop 7
```

## Checkpoints

### C1 — El harness está completo
- [x] Archivos base: `AGENTS.md`, `init.sh`, `feature_list.json`, `progress/current.md`, `CHECKPOINTS.md`
- [x] Docs: `docs/prd.md`, `docs/architecture.md`, `docs/conventions.md`, `docs/verification.md`
- [x] Skills: leader / implementer / reviewer under `.agents/skills/`
- [x] `./init.sh` exit 0

### C2 — El estado es coherente
- [x] Como mucho una feature `in_progress` (solo F015)
- [x] Features `done` previas con monorepo tests green
- [x] `progress/current.md` describe sesión F015 activa (handoff listo para reviewer)

### C3 — El código respeta la arquitectura
- [x] `packages/domain` no importa react, electron, fs, ni xlsx
- [x] `packages/ui` no implementa fórmulas de costo ni accede a fs / xlsx
- [x] `packages/excel` no importa react ni electron (no tocado)
- [x] Errores de dominio: F015 no introduce strings crudos de dominio
- [x] Sin `console.log` de debug en sources F015

### C4 — La verificación es real
- [x] `pnpm --filter @muebles/domain test` 100% (60)
- [x] Export fixture path N/A for F015
- [x] Storage path N/A for F015 (append via existing workspace)
- [x] Golden / plantilla motor still green in monorepo

### C5 — Cierre de sesión (post-approve, owner: leader)
- [x] Sin artefactos sospechosos en sources revisados (`duplicate.ts`/tests, UI screens, App wiring)
- [ ] `progress/history.md` entrada de **esta** sesión — pendiente al cerrar (leader)
- [ ] Feature en estado final correcto en `feature_list.json` — sigue `in_progress` (correcto pre-approve; leader marca `done`)
- [ ] `progress/current.md` limpio — pendiente al archivar sesión (leader)

> C5 open boxes are **session-close duties for the leader after approval**, not F015 defects. Reviewer does not mark `done` or close the session.

## Residual notes (non-blocking)

1. **Part `code` not remapped to new module code** — `cloneBoardPart` keeps `part.code` (e.g. still `MOD-GAB-01-P01` under module `MOD-GAB-01-COPY`). Conventions suggest `{moduleCode}-P{nn}`; nested **ids** are refreshed. Optional polish later if export/labels need aligned codes.
2. **Feature description says “editor de mueble”** — implementation places **Duplicar** on module **list** row (and project list). Acceptance criteria do not require editor placement; list action is coherent with create→list pattern.
3. **No RTL/DOM tests** for the Duplicar buttons — matches other catalog row actions; acceptance logic covered by domain unit tests (documented in handoff).
4. **Desktop shell** has no Modules/Projects screen wiring yet — out of scope for this feature (web + domain + shared UI).

## Cambios requeridos

Ninguno.

## Leader next steps (not reviewer)

1. Marcar F015 `done` en `feature_list.json`.
2. Archivar sesión en `progress/history.md` y limpiar/actualizar `progress/current.md`.
3. Tomar F016 (`ui_design_system`) según `feature_list.json`.
