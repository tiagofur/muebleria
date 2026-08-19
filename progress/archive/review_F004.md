# Review — feature F004

**Veredicto:** APPROVED  
**Feature:** F004 — excel_optimizer_export  
**Reviewer:** reviewer agent  
**Date:** 2026-07-15  
**Handoff:** `progress/impl_F004.md`

## Acceptance criteria → evidence

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | Columnas A–J en orden correcto | PASS | `OPTIMIZER_DATA_HEADERS` in `packages/excel/src/optimizerExport.ts` L10–21 matches `Plantilla_Optimizer.xlsx` row 2 exactly: Cantidad, Largo, Ancho, Descripcion, Materia Prima, veta, Largo 1, Largo 2, Ancho 1, Ancho 2. Row 1 merges Material A1:E1 / Cubrecanto F1:J1. Test `optimizerExport.test.ts` L77–93. (feature_list short names L1…W2 map to plantilla “Largo 1”…“Ancho 2”.) |
| 2 | Herrajes ausentes (EXP-05) | PASS | `generateCutRows` only iterates `bom.boardParts` (`engine.ts` L776–806); never touches hardware. Domain test length = `modGab01.boardParts.length` (8) + no bisagra/jaladera/tornillo (`engine.test.ts` L580–588). Excel fixture length 8 (`optimizerExport.test.ts` L95–100). |
| 3 | qty_pieza × qty_proyecto (EXP-02) | PASS | `quantity: part.quantity * item.quantity` (`engine.ts` L798). Domain test qty 3 → Costado Derecho = 3 (`engine.test.ts` L561–578). Excel export qty 2 → all column A = 2 (`optimizerExport.test.ts` L130–149). |
| 4 | Orden determinista módulo → part code (EXP-04) | PASS | Sort `moduleCode` → `partCode` → description → partId (`engine.ts` L817–825). Test: full project CAJ before GAB; GAB descriptions P01…P08 order (`engine.test.ts` L591–620). |
| 5 | Fixture MOD-GAB-01 × 1 vs expected JSON | PASS | `modGab01CutRows.json` equals `generateCutRows(gabOnlyProject, …)`; serialized A–J cells match each expected row (`optimizerExport.test.ts` L95–128). Spot-check: Costado 720×590 edges 1/1/1/1 ARAUCO; Puerta 717×296 grain 1 MADERADO; Respaldo edges 0 — matches `plantillaDemo.ts` board parts. |
| 6 | Archivo abre sin error | PASS | exceljs round-trip load of written buffer (`optimizerExport.test.ts` L158–167). Smoke: `node packages/excel/src/__fixtures__/smokeExport.mjs` → `/tmp/optimizer_smoke.xlsx` (8 data rows). Plantilla headers verified against repo `Plantilla_Optimizer.xlsx`. |

## Architecture boundaries (C3)

| Check | Result |
|-------|--------|
| excel only serializes `ProductionCutRow[]` | PASS — `optimizerExport` maps DTO fields to cells; no BOM/cost math |
| No cost formulas in excel | PASS — no `calc*`, no margin/labor/price |
| domain pure (no react/electron/fs/xlsx) | PASS — `generateCutRows` in `engine.ts` uses only domain types + resolveBom |
| excel no react/electron | PASS — deps: exceljs + `@muebles/domain` |
| Errors are DomainError subclasses | PASS — VAL-05 throws `ValidationError` in domain and excel |
| No `console.log` in production sources | PASS (smoke script logs path only) |

Boundary note (non-blocking): production excel imports runtime `ValidationError` from domain (not only types). Architecture table says “domain types”; shared error class for VAL-05 is acceptable and consistent with domain error model. Tests may import `generateCutRows` for e2e fixture — production excel does not call the engine.

## Conventions

- Module file `optimizerExport.ts` + colocated `optimizerExport.test.ts` — PASS  
- Fixtures under `src/__fixtures__/` (JSON golden) — PASS  
- Header comment + ESM + single quotes — PASS  
- Domain API `generateCutRows(project, catalog)` exported from package index — PASS  
- EXP-03 configurable name-vs-code not implemented — default `material.name` only (PRD default; documented in handoff) — OK for F004 scope  

## Commands executed (reviewer)

```text
./init.sh                              # exit 0 — [OK] Entorno listo
pnpm --filter @muebles/domain test     # 29/29
pnpm --filter @muebles/excel test      # 7/7
pnpm test                              # all workspaces green
pnpm --filter @muebles/{domain,excel} typecheck  # ok
node packages/excel/src/__fixtures__/smokeExport.mjs  # Wrote /tmp/optimizer_smoke.xlsx (8 data rows)
# Plantilla_Optimizer.xlsx headers verified via exceljs (match OPTIMIZER_DATA_HEADERS + merges)
```

## Checkpoints

### C1 — El harness está completo
- [x] Archivos base: `AGENTS.md`, `init.sh`, `feature_list.json`, `progress/current.md`, `CHECKPOINTS.md`
- [x] Docs: `docs/prd.md`, `docs/architecture.md`, `docs/conventions.md`, `docs/verification.md`
- [x] Skills: leader / implementer / reviewer under `.agents/skills/`
- [x] `./init.sh` exit 0

### C2 — El estado es coherente
- [x] Como mucho una feature `in_progress` (solo F004)
- [x] Features `done` (F001–F003) con monorepo tests green
- [x] `progress/current.md` describe sesión F004 activa (handoff clear)

### C3 — El código respeta la arquitectura
- [x] `packages/domain` no importa react, electron, fs, ni xlsx
- [x] `packages/ui` no implementa fórmulas ni accede a fs (no tocado)
- [x] `packages/excel` no importa react ni electron
- [x] Errores del dominio son `DomainError` / subclases
- [x] Sin `console.log` de debug en sources de producción domain/excel

### C4 — La verificación es real
- [x] `pnpm --filter @muebles/domain test` 100% (29/29)
- [x] Export fixture: `modGab01CutRows.json` + cell-level A–J equality
- [x] Storage tmp — N/A (F004 no toca storage)
- [x] Golden motor (F003) still green within monorepo run; F004 adds cut-list fixture path (Nivel 5 smoke)

### C5 — Cierre de sesión (post-approve, owner: leader)
- [x] Sin artefactos sospechosos en paquetes tocados (src + fixtures; no dist committed)
- [ ] `progress/history.md` entrada de **esta** sesión — pendiente al cerrar (leader)
- [ ] Feature en estado final correcto en `feature_list.json` — sigue `in_progress` (correcto pre-approve; leader marca `done`)
- [ ] `progress/current.md` limpio — pendiente al archivar sesión (leader)

> C5 open boxes are **session-close duties for the leader after approval**, not F004 defects. Reviewer does not mark `done` or close the session.

## Residual notes (non-blocking)

1. **`smokeExport.mjs` reimplements layout** instead of calling `optimizerExport`. Drift risk if headers/styles change; prefer importing the real exporter later (or document intentional independence).
2. **EXP-03** name-vs-code configurability not in scope; only `material.name` — correct per handoff/PRD default.
3. **Dual VAL-05** (empty list rejected in both `generateCutRows` and `optimizerExport`) is intentional defense-in-depth for direct callers of the excel API.

## Cambios requeridos

Ninguno.

## Leader next steps (not reviewer)

1. Marcar F004 `done` en `feature_list.json`.
2. Archivar sesión en `progress/history.md` y limpiar/actualizar `progress/current.md`.
3. Tomar F005 (`storage_layer`) como siguiente feature pending.
