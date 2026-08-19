# Handoff F015 — duplicate_module_project

**Status:** implemented, tests green — awaiting reviewer  
**Feature:** F015 — Duplicar módulo / proyecto (MOD-05)  
**Do not mark `done` without reviewer approval**

## Acceptance

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | Duplicar módulo crea copia con code sugerido (ej. `MOD-GAB-01-COPY`) (MOD-05) | `suggestDuplicateCode` + `duplicateModule`; UI botón **Duplicar** en lista de módulos; shell `duplicateModuleById` |
| 2 | Duplicar proyecto crea copia en draft con todos los ítems y opciones | `duplicateProject` → `status: 'draft'`, items con mismos `moduleId`/`quantity`/`optionChoices`, sin `priceSnapshot`; botón en lista de proyectos |
| 3 | El módulo original no se modifica | Deep copy inmutable: tests assert `structuredClone` equality of original after duplicate; project dup keeps same `moduleId` (master untouched) |

## Implementation

### Domain (`packages/domain/src/duplicate.ts`)

- `suggestDuplicateCode(code, existingCodes)` → `CODE-COPY`, then `COPY2`, `COPY3`… (case-insensitive collision)
- `duplicateModule(module, { newId, newCode, newName?, nextNestedId? })` → new module id/code/name; fresh UUIDs for boardParts + hardwareLines; cloned edges/dims
- `duplicateProject(project, { newId, itemIdFactory, nowIso, newName? })` → draft, no snapshot, new item ids, preserved choices

### UI

- `ModulesScreen`: optional `onDuplicate?.(id)` + row action **Duplicar**
- `ProjectsScreen`: optional `onDuplicate?.(id)` + row action **Duplicar**

### Web shell

- `duplicateModuleById` / `duplicateProjectById` use `crypto.randomUUID` + domain helpers + workspace patch

## Files touched

- `packages/domain/src/duplicate.ts` — new
- `packages/domain/src/duplicate.test.ts` — new (7 tests)
- `packages/domain/src/index.ts` — exports
- `packages/ui/src/modules/ModulesScreen.tsx` — Duplicar
- `packages/ui/src/projects/ProjectsScreen.tsx` — Duplicar
- `apps/web/src/App.tsx` — wire handlers
- `feature_list.json` — F015 `in_progress`
- `progress/current.md` — session state

## Tests (all green)

| Package | Result |
|---------|--------|
| domain | 60/60 (+7 duplicate) |
| ui | 56/56 |
| excel | 14/14 |
| storage | 17/17 |
| web | 30/30 |
| desktop | 7/7 |
| typecheck | all packages OK |

## Reviewer notes

- Helpers live in domain (pure, injectable nested id factories) so shells stay thin.
- Duplicate does not open the copy for edit; it only appends to the list (same pattern as create → list).
- Module codes from seed (`MOD-GAB-01`) become `MOD-GAB-01-COPY`; second duplicate gets `…-COPY2`.
- Project name default: `${name} (copia)`.
- No RTL/component tests for the button (prop-driven like other catalog row actions); domain unit tests cover acceptance logic.

## Out of scope (not done)

- F016 design system
- Desktop-specific shell wiring (desktop has no Modules/Projects screen yet)
- Auto-select / open editor on the new copy after duplicate
