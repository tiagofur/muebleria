# Closeout — F019 ui_toast_system

**Date:** 2026-07-15  
**Status:** closed (`done`)

F019 (shared toast system in `@muebles/ui`: `ToastProvider` + `useToast().toast({ type, message })`, top-right stack max 3 with oldest exit, 4s auto-dismiss + progress bar, types success/info/warning/error with semantic tokens and Lucide icons, enter/exit motion under `prefers-reduced-motion`, wired at `apps/web` App root for create/update/deactivate/reactivate/duplicate/export; export validation remains inline via `ExportIssueList`) was self-verified green (domain 60, ui 97, excel 14, storage 17, web 37, desktop 7, monorepo `./init.sh`), reviewed with verdict **APPROVED** in `progress/review_F019.md` (all 7 acceptance criteria + design §4.4 + C1–C5 pass; residual notes non-blocking — acceptance “Creado correctamente” vs design `✓ "{code}" creado`, brief exit-phase overflow, F020 catalog modal out of scope), and harness-closed: `feature_list.json` status set to `done`, session summary appended to `progress/history.md`, and `progress/current.md` reset to idle with next feature F020 (`ui_catalogs_modal_list`) still pending and not started.

## Key artifacts
- `packages/ui/src/common/Toast.tsx` — provider, hook, viewport, cards
- `packages/ui/src/common/toast.css` — tokens-only styles + motion
- `packages/ui/src/common/Toast.test.tsx` — 9 RTL/jsdom + CSS/source guards
- `packages/ui/src/common/index.ts` / `packages/ui/src/index.ts` — package export surface
- `apps/web/src/App.tsx` — ToastProvider root + toast calls
- `apps/web/src/designSystemShell.test.ts` — F019 wiring guards
- Handoff / review: `progress/impl_F019.md`, `progress/review_F019.md`

## Next
- F020 — ui_catalogs_modal_list (pending; not started)
