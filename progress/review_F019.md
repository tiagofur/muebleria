# Review — feature F019

**Veredicto:** APPROVED  
**Feature:** F019 — ui_toast_system  
**Reviewer:** reviewer + closer agent  
**Date:** 2026-07-15  
**Handoff:** `progress/impl_F019.md`  
**Design:** `docs/design.md` §4.4 (+ §3.6 motion, §3.7 icons)

## Acceptance criteria → evidence

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | `useToast().toast({ type, message })` top-right | PASS | `ToastProvider` portals `.ui-toast-viewport` with `top/right: var(--space-4)`. Hook throws outside provider. RTL: “renders in top-right viewport” |
| 2 | Auto-dismiss 4s | PASS | `TOAST_DURATION_MS = 4000`; progress bar `.ui-toast__progress` + `animationDuration`; test advances timers then unmounts after exit |
| 3 | Max 3 simultaneous (oldest exits) | PASS | `TOAST_MAX = 3`; burst-4 test drops oldest “One”, keeps “Four” |
| 4 | Types success/info/warning/error + token colors | PASS | CSS `--success-*`, `--info-*`, `--warning-*`, `--danger-*` on type classes; source + CSS guards; Lucide icons per type |
| 5 | Enter/exit animation | PASS | phases `enter` / `visible` / `exit`; CSS translateX+opacity under `prefers-reduced-motion: no-preference`; reduced-motion disables motion + progress |
| 6 | Create material → success toast | PASS | `App.createMaterial` → `✓ "${code}" creado` (design.md §4.4; acceptance wording “Creado correctamente” satisfied by design-canonical message — see residual #1) |
| 7 | Export Optimizer success toast; validation inline | PASS | success `✓ ${result.fileName} descargado`; failures only `setExportErrors` + comment “Validation issues stay inline” |

### Design §4.4 spot-check

| Spec | Result | Notes |
|------|--------|-------|
| Position top-right | PASS | fixed viewport `top/right: var(--space-4)` |
| Auto-dismiss 4s + progress | PASS | constants + CSS keyframes `ui-toast-progress` |
| Max 3 (oldest exits) | PASS | `beginExit` on overflow |
| Create / update / deactivate / reactivate / export messages | PASS | App message map matches design table |
| Validation errors not toasts | PASS | Optimizer + hardware list fail paths set export errors only |
| Tokens only (no hex) | PASS | no `#`/`rgb`/`hsl` literals in `toast.css` |
| Lucide `strokeWidth={1.5}` | PASS | CheckCircle2 / Info / AlertTriangle / AlertCircle / X |
| Motion + reduced-motion | PASS | transitions + progress only under `no-preference`; reduce hides progress |

## Architecture boundaries (C3)

| Check | Result |
|-------|--------|
| domain pure | PASS — no domain changes |
| UI no cost formulas / no fs / no xlsx | PASS — presentational toast only |
| excel / storage / desktop | PASS — F019 scoped to `@muebles/ui` common + `apps/web` App wiring |
| No debug `console.log` | PASS in Toast sources |

## Conventions

- Component under `packages/ui/src/common/` with colocated CSS + tests — PASS  
- Exported from `@muebles/ui` (`ToastProvider`, `useToast`, duration/max constants, types) — PASS (`index.ts` + export surface test)  
- RTL + jsdom for Toast (`@vitest-environment jsdom`); other ui tests remain node — PASS  
- Spanish UI strings; English identifiers — PASS  

## Diseño UI/UX (fase 4)

- D1: [x] Variables CSS del design system (no hardcoded palette)
- D2: [x] Toast stack top-right per §4.4
- D3: [x] Modales N/A (F018 already closed)
- D4: [x] Toasts: top-right, 4s auto-dismiss, max 3, correct types + progress bar
- D5: [x] Solo Lucide con `strokeWidth={1.5}`
- D6: [x] Animaciones con `prefers-reduced-motion: no-preference`

## Checkpoints

- C1: [x] Harness completo; `./init.sh` exit 0
- C2: [x] Una sola `in_progress` (F019) at review time; session documented; post-close → done + idle
- C3: [x] Boundaries respetados
- C4: [x] Tests monorepo verdes (ui 97 incl. 9 Toast, web 37, domain 60, excel 14, storage 17, desktop 7)
- C5: [x] Closeout: `history.md` entry, `feature_list` F019=`done`, `current.md` idle → F020, `close_F019.md`

## Residual notes (non-blocking — no CHANGES_REQUESTED)

1. Feature-list acceptance says toast “Creado correctamente”; design.md §4.4 (referenced) specifies `✓ "{code}" creado`. Implementation follows design — correct product copy.
2. Delete module/project/option-group use plain info toasts (“… eliminado”); design table only specifies deactivate/reactivate — acceptable extras.
3. When a 4th toast is pushed, oldest briefly exists in `exit` phase (DOM can show 4 nodes momentarily); non-exit cap is 3 — matches “máx 3 simultáneos / el más antiguo sale”.
4. Catalog list/modal refactor remains F020 (explicitly out of scope).

## Verification

| Level | Result |
|-------|--------|
| Nivel 2 ui | PASS — 97/97 (incl. 9 Toast + export) |
| Nivel 2 web | PASS — 37/37 (incl. F019 App wiring guards) |
| Nivel 1 domain / excel / storage / desktop | PASS — 60 / 14 / 17 / 7 |
| Nivel 3 monorepo | PASS — `./init.sh` exit 0 |

## Commands executed (reviewer)

```text
./init.sh
  # exit 0 — domain 60, excel 14, storage 17, ui 97, web 37, desktop 7
```

## Verdict rationale

All seven acceptance criteria pass against source, design §4.4, architecture boundaries, and green monorepo tests (queue/max 3, auto-dismiss, types/tokens, App wiring for create/export). No required changes.
