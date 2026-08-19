# Review — feature F103

**Veredicto:** APPROVED

## Checkpoints
- C1: [x] Harness/document sources exist; proportional documentary readback was completed. `git diff --check` is clean and `feature_list.json` parses.
- C2: [x] F103 is published as the only documented in-progress feature; the owner’s `processStage` WIP remains uncommitted and outside F103.
- C3: [x] `docs/architecture.md` retains the UI/domain boundary; no application, route, RBAC, backend, or domain source was included in commit `649b6fc`.
- C4: [x] The canonical matrix matches all 24 `NAV_PATHS` ids exactly (no missing or extra rows). Markdown links in the touched docs resolve.
- C5: [x] F103 is published at `649b6fc` and `HEAD == origin/main`.

## Diseño UI/UX
- D1: [x] F100–F102 are represented as implemented with concrete owners and bounded QA; unimplemented global contrast, targets, overlay migration, z-index, and breakpoint reconciliation remain planned.
- D2: [x] The stale `/produccion` prose is corrected: `orders` is `/orders` and the station surface is `production` at `/production`.
- D3: [x] The old “unauthorized `/orders` renders a blank main” claim is corrected and now accurately references `navBlockedForSession` plus the redirect in `apps/web/src/App.tsx`.
- D4: [x] Embarques and Instalaciones now name their distinct executable guards and role sets: `roleCanAccessEmbarquesNav` for `shipments`, `roleCanAccessShippingNav` for `installations`.
- D5: [x] Historical aliases are isolated as deprecated; `routes.ts`/RBAC stay stated as executable authority.
