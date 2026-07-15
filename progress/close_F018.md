# Closeout — F018 ui_modal_component

**Date:** 2026-07-15  
**Status:** closed (`done`)

F018 (reusable `Modal` in `@muebles/ui`: overlay `--surface-overlay`, scale+opacity open/close, sticky header title + Lucide X, scrollable body, optional sticky footer, sizes sm 480 / md 680 / lg 900, Esc + overlay close, focus trap, body scroll lock, `role=dialog` / `aria-modal` / `aria-labelledby`) was self-verified green (domain 60, ui 87, excel 14, storage 17, web 35, desktop 7, monorepo `./init.sh`), reviewed with verdict **APPROVED** in `progress/review_F018.md` (all 7 acceptance criteria + design §4.3 + C1–C5 pass; residual notes non-blocking — no catalog consumers until F020, overlay non-focusable by design, `MODAL_CLOSE_MS` mirrors token), and harness-closed: `feature_list.json` status set to `done`, session summary appended to `progress/history.md`, and `progress/current.md` reset to idle with next feature F019 (`ui_toast_system`) still pending and not started.

## Key artifacts
- `packages/ui/src/common/Modal.tsx` — modal component (portal to `document.body`)
- `packages/ui/src/common/modal.css` — tokens-only styles + motion
- `packages/ui/src/common/Modal.test.tsx` — 18 RTL/jsdom + CSS/source guards
- `packages/ui/src/common/index.ts` — barrel
- `packages/ui/src/index.ts` / `index.test.ts` — package export surface
- Handoff / review: `progress/impl_F018.md`, `progress/review_F018.md`

## Next
- F019 — ui_toast_system (pending; not started)
