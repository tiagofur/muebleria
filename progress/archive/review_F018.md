# Review — feature F018

**Veredicto:** APPROVED  
**Feature:** F018 — ui_modal_component (reusable Modal)  
**Reviewer:** reviewer + closer agent  
**Date:** 2026-07-15  
**Handoff:** `progress/impl_F018.md`  
**Design:** `docs/design.md` §4.3 (+ §3.6 motion, §3.7 icons)

## Acceptance criteria → evidence

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | Open animation scale + opacity; close animation | PASS | `modal.css`: baseline `opacity: 0` + `scale(0.96)`; `.is-open` → opacity 1 / scale(1); `.is-closing` reverse. Transitions under `@media (prefers-reduced-motion: no-preference)` with `--duration-slow` / `--ease-out`. `Modal.tsx` keeps portal mounted `MODAL_CLOSE_MS` (350) then unmounts. Tests: open/close class + unmount after duration |
| 2 | Esc closes modal | PASS | document `keydown` Escape → `onClose` (`Modal.tsx` L132–144). Test: “closes on Escape” |
| 3 | Overlay/backdrop click closes | PASS | `.ui-modal__overlay` `onClick={onClose}`; background `var(--surface-overlay)`. Test: “closes on overlay click” |
| 4 | Tab / Shift+Tab focus trap | PASS | `onPanelKeyDown` wraps last→first / first→last among focusables; empty list focuses panel. RTL: 8 Tab and 8 Shift+Tab stay inside dialog |
| 5 | Document body no scroll while open | PASS | `document.body.style.overflow = 'hidden'` while `rendered`; restored on unmount. Test restores prior `auto` |
| 6 | Sizes sm / md / lg | PASS | CSS max-width 480 / 680 / 900; classes `ui-modal--sm|md|lg`; default `md`. Tests per size + default |
| 7 | `aria-modal` + `aria-labelledby` (and dialog) | PASS | `role="dialog"`, `aria-modal="true"`, `aria-labelledby={titleId}` on panel; title `h2` with matching `id` from `useId`. A11y test asserts labelled title text |

### Design §4.3 spot-check

| Spec | Result | Notes |
|------|--------|-------|
| SM 480 / MD 680 / LG 900 | PASS | `.ui-modal--sm/md/lg` |
| Sticky header title + X | PASS | `.ui-modal__header` sticky; Lucide `X` size 16, `strokeWidth={1.5}`, `aria-label="Cerrar"` |
| Scrollable body | PASS | `.ui-modal__body { overflow-y: auto }` |
| Sticky footer slot | PASS | optional `footer` → `.ui-modal__footer` sticky |
| Overlay token | PASS | `var(--surface-overlay)` |
| Tokens only (no hex) | PASS | CSS guard rejects `#[0-9a-f…]`; radii/shadows/spaces from design tokens |
| Motion + reduced-motion | PASS | transitions only inside `prefers-reduced-motion: no-preference` |
| Portal to body | PASS | `createPortal(..., document.body)` |

## Architecture boundaries (C3)

| Check | Result |
|-------|--------|
| domain pure | PASS — no domain changes |
| UI no cost formulas / no fs / no xlsx | PASS — presentational dialog only |
| excel / storage / apps | PASS — F018 scoped to `@muebles/ui` common + package test config |
| No debug `console.log` | PASS in Modal sources |

## Conventions

- Component under `packages/ui/src/common/` with colocated CSS + tests — PASS  
- Exported from `@muebles/ui` (`Modal`, `ModalProps`, `ModalSize`) — PASS (`index.ts` + export surface test)  
- RTL + jsdom only for Modal (`@vitest-environment jsdom`); other ui tests remain node — PASS  
- Spanish UI label `"Cerrar"`; English identifiers — PASS  

## Diseño UI/UX (fase 4)

- D1: [x] Variables CSS del design system (no hardcoded palette)
- D2: [x] Estructura modal §4.3 (header / body / footer sticky slots)
- D3: [x] Focus trap + Esc + overlay close + body scroll lock
- D4: [x] Toasts N/A (F019)
- D5: [x] Solo Lucide con `strokeWidth={1.5}`
- D6: [x] Animaciones con `prefers-reduced-motion: no-preference`

## Checkpoints

- C1: [x] Harness completo; `./init.sh` exit 0
- C2: [x] Una sola `in_progress` (F018) at review time; session documented; post-close → done + idle
- C3: [x] Boundaries respetados
- C4: [x] Tests monorepo verdes (ui 87 incl. 18 Modal, web 35, domain 60, excel 14, storage 17, desktop 7)
- C5: [x] Closeout: `history.md` entry, `feature_list` F018=`done`, `current.md` idle → F019, `close_F018.md`

## Residual notes (non-blocking — no CHANGES_REQUESTED)

1. Catalogs still use non-modal forms; migration is F020 (explicitly out of scope).
2. Overlay is a non-focusable `div` (`aria-hidden`) — intentional so trap stays on panel controls.
3. Close animation duration is hardcoded as `MODAL_CLOSE_MS = 350` to match `--duration-slow`; CSS token change would need a code constant update (acceptable for now).
4. No production consumer of `Modal` yet (first real usage expected in F020+); component is exported and fully tested.

## Verification

| Level | Result |
|-------|--------|
| Nivel 2 ui | PASS — 87/87 (incl. 18 Modal + export) |
| Nivel 2 web | PASS — 35/35 |
| Nivel 1 domain / excel / storage / desktop | PASS — 60 / 14 / 17 / 7 |
| Nivel 3 monorepo | PASS — `./init.sh` exit 0 |

## Commands executed (reviewer)

```text
./init.sh
  # exit 0 — domain 60, excel 14, storage 17, ui 87, web 35, desktop 7
```

## Verdict rationale

All seven acceptance criteria pass against source, design §4.3, architecture boundaries, and green monorepo tests (including RTL focus trap / Esc / overlay / scroll lock). No required changes.
