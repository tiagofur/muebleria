# Review — feature F013

**Veredicto:** APPROVED  
**Feature:** F013 — hardware_list_export  
**Reviewer:** reviewer agent  
**Date:** 2026-07-15  
**Handoff:** `progress/impl_F013.md`

## Acceptance criteria → evidence

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | Lista generada con qty × ítem de proyecto correctas (EXP-08) | PASS | `generateHardwareList` (`engine.ts` L975–1072): `qty = line.quantity * item.quantity`, sum by `hardwareId`, board parts never included. GAB×1 exact known qtys (bisagra 2, jaladera 1, pata 4, tornillo 40, soporte 4) + lineCost (`engine.test.ts` L914–967). Same module ×2 doubles qty/cost (L969–1000). Item qty 3 → bisagra 6 / lineCost 210 (L1002–1019). Plantilla multi-module includes corredera, no board codes (L1021–1033). |
| 2 | Formato usable directamente para compras | PASS | XLSX sheet `Herrajes` with headers `Código \| Descripción \| Unidad \| Cantidad \| Costo unit. \| Costo total` (`hardwareListExport.ts` L10–18, L62–118); unit labels Pieza/Juego/Metro; numeric costs `0.00`. Optional CSV same columns (`hardwareListExportCsv`, L131–154). Web download `.xlsx` via `buildHardwareListExport` + `downloadHardwareListXlsx` (`exportHardwareList.ts`). UI button **Lista de herrajes** next to Optimizer (`ProjectsScreen.tsx` L645–664). Excel round-trip 5 HER-* rows, no TAB-* (`hardwareListExport.test.ts` L63–102). |

### PRD / independent logic

| Check | Expected | Implementation |
|-------|----------|----------------|
| EXP-08 CSV/XLSX simple | purchase-usable list | XLSX primary + CSV helper; headers in Spanish workshop language |
| qty rule | hardwareLine.qty × project item qty | `engine.ts` L1036 |
| aggregation | by catalog hardware | Map keyed by `hardware.id` (L1037–1042) |
| sort | deterministic | code then description (`localeCompare`, L1065–1069) |
| empty list | fail actionably | `ValidationError` `no hay herrajes para exportar` (domain L1046–1050; excel empty guard) |
| no boards | hardware only | only `bom.hardwareLines`; tests assert `HER-*` only |
| pre-export integrity | same as Optimizer path | shell `collectExportIssues` before aggregate (`exportHardwareList.ts` L50–53) |
| shell wiring | thin app | `App.handleExportHardwareList` → build → download (App.tsx L771–788); UI prop only |

Plantilla GAB hardware lines (fixture) match test expectations: 2/1/4/40/4 (`plantillaDemo.ts` L330–360).

## Architecture boundaries (C3)

| Check | Result |
|-------|--------|
| domain pure (no react/electron/fs/xlsx) | PASS — aggregation in `engine.ts` / type in `types.ts`; only local imports + `errors` |
| UI no cost formulas / no fs / no xlsx | PASS — button + optional `onExportHardware`; qty/cost computed in domain |
| excel serializes DTOs only | PASS — takes `HardwarePurchaseRow[]` (domain DTO), writes ExcelJS/CSV; same ValidationError pattern as `optimizerExport` |
| excel no react/electron | PASS |
| Apps = thin shells | PASS — web pipeline mirrors Optimizer: validate → domain → excel → download |
| DomainError / ValidationError / ResolutionError | PASS — empty list, inactive hardware, missing module/hw |
| Sin `console.log` debug | PASS — none in F013 production sources |

## Conventions

- Modules `hardwareListExport.ts`, `exportHardwareList.ts`; type `HardwarePurchaseRow`; fn `generateHardwareList` — PASS  
- `readonly` fields on `HardwarePurchaseRow` — PASS  
- Colocated tests (`engine.test.ts`, `hardwareListExport.test.ts`, `exportHardwareList.test.ts`, App F013 cases) — PASS  
- Spanish UI copy (**Lista de herrajes**); English identifiers — PASS  
- Package exports: domain `generateHardwareList` / `HardwarePurchaseRow`; excel `hardwareListExport` / `hardwareListExportCsv` / `HARDWARE_LIST_HEADERS` — PASS  
- File headers + arrange–act–assert plantilla fixtures — PASS  

## Verification (docs/verification.md)

| Level | Result |
|-------|--------|
| Nivel 1 domain | PASS — 52/52 (includes 6 `generateHardwareList` + type shape) |
| Nivel 2 excel | PASS — 14/14 (6 hardware list + 7 optimizer + index) |
| Nivel 2 ui | PASS — 55/55 (no formula regression; surface prop) |
| Nivel 2 web | PASS — 30/30 (`exportHardwareList` 4 + App F013 2 + prior) |
| Nivel 2 storage / desktop | PASS — monorepo green (17 / 7) |
| Nivel 3 monorepo | PASS — `./init.sh` exit 0 |
| Nivel 4 golden motor | N/A as F013 scope (hardware qty, not sale price); plantilla path still green in monorepo |
| Export fixture analogue | PASS — XLSX round-trip + known GAB qtys (not ProductionCutRow; hardware DTO path) |

## Commands executed (reviewer)

```text
./init.sh
  # exit 0 — domain 52, excel 14, ui 55, storage 17, web 30, desktop 7

pnpm --filter @muebles/domain test   # 52/52
pnpm --filter @muebles/excel test    # 14/14
pnpm --filter @muebles/ui test       # 55/55
pnpm --filter @muebles/web test      # 30/30
```

## Checkpoints

### C1 — El harness está completo
- [x] Archivos base: `AGENTS.md`, `init.sh`, `feature_list.json`, `progress/current.md`, `CHECKPOINTS.md`
- [x] Docs: `docs/prd.md`, `docs/architecture.md`, `docs/conventions.md`, `docs/verification.md`
- [x] Skills: leader / implementer / reviewer under `.agents/skills/`
- [x] `./init.sh` exit 0

### C2 — El estado es coherente
- [x] Como mucho una feature `in_progress` (solo F013)
- [x] Features `done` previas con monorepo tests green
- [x] `progress/current.md` describe sesión F013 activa (implemented, awaiting review)

### C3 — El código respeta la arquitectura
- [x] `packages/domain` no importa react, electron, fs, ni xlsx
- [x] `packages/ui` no implementa fórmulas de costo ni accede a fs / xlsx
- [x] `packages/excel` no importa react ni electron
- [x] Errores de dominio: `ValidationError` / `ResolutionError`; shell maps `DomainError` → `ExportIssue`
- [x] Sin `console.log` de debug en sources F013

### C4 — La verificación es real
- [x] `pnpm --filter @muebles/domain test` 100% (52)
- [x] Export hardware fixture / round-trip green (excel package)
- [x] UI / web packages green
- [x] Golden / prior optimizer paths still green in monorepo

### C5 — Cierre de sesión (post-approve, owner: leader)
- [x] Sin artefactos sospechosos en sources revisados (domain/excel/ui/web F013 paths)
- [ ] `progress/history.md` entrada de **esta** sesión — pendiente al cerrar (leader)
- [ ] Feature en estado final correcto en `feature_list.json` — sigue `in_progress` (correcto pre-approve; leader marca `done`)
- [ ] `progress/current.md` limpio — pendiente al archivar sesión (leader)

> C5 open boxes are **session-close duties for the leader after approval**, not F013 defects. Reviewer does not mark `done` or close the session.

## Residual notes (non-blocking)

1. **Desktop no cablea `onExportHardware`** — documentado en handoff; UI prop ready; web shell only. Same pattern as incomplete desktop host wiring for newer exports.
2. **UI download is XLSX only** — CSV API exists in excel package but is not exposed in the button path. Meets EXP-08 (“CSV/XLSX simple”) and purchase usability via XLSX.
3. **`collectExportIssues` gates hardware export** — projects blocked for Optimizer (missing options, no board parts, inactive materials, etc.) also blocked for herrajes. Consistent integrity policy; edge case “hardware-only module without boards” would hit VAL-05 before purchase list — out of current product shapes.
4. **Purchase list uses live catalog costs**, not `priceSnapshot` — correct for buying materials at current supplier prices; quote freeze remains about sale/quote totals (F012).
5. **No RTL/DOM click test** on **Lista de herrajes** — shell + domain + excel contracts covered; same residual pattern as F010 export button.

## Cambios requeridos

Ninguno.

## Leader next steps (not reviewer)

1. Marcar F013 `done` en `feature_list.json`.
2. Archivar sesión en `progress/history.md` y limpiar/actualizar `progress/current.md`.
3. Tomar F014 (`waste` UI / siguiente pending) según `feature_list.json`.
