# Closeout — F017 ui_layout_sidebar

**Date:** 2026-07-15  
**Status:** closed (`done`)

F017 (AppShell: dark sidebar 240px + top bar 56px + content area; TRABAJO/CONFIG Lucide nav; active brand-400 left border; collapse + hamburger &lt;900px; replace horizontal tabs in `App.tsx`) was self-verified green (domain 60, ui 68, excel 14, storage 17, web 35, desktop 7, monorepo `./init.sh`), reviewed with verdict **APPROVED** in `progress/review_F017.md` (all 6 acceptance criteria + design §4.1/§3.7 + C1–C5 pass; residual notes non-blocking — brand in sidebar vs ASCII topbar, no search/user chrome, no RTL hamburger, dist lag, Home placeholder until F023), and harness-closed: `feature_list.json` status set to `done`, session summary appended to `progress/history.md`, and `progress/current.md` reset to idle with next feature F018 (`ui_modal_component`) still pending and not started.

## Key artifacts
- `packages/ui/src/shell/AppShell.tsx` — shell + `APP_NAV_SECTIONS`
- `packages/ui/src/shell/appShell.css` — layout tokens-only
- `packages/ui/src/shell/appShell.test.ts` — nav map / CSS / structure guards
- `apps/web/src/App.tsx` — AppShell wiring, Home placeholder, navId routes
- `apps/web/src/app.css` — home card only (tabs chrome removed)
- `apps/web/src/designSystemShell.test.ts` — F017 wiring guards
- Handoff / review: `progress/impl_F017.md`, `progress/review_F017.md`

## Next
- F018 — ui_modal_component (pending; not started)
