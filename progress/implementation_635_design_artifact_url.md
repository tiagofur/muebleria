# Issue #635 — Design artifact URL resolution and browser access

Status: `IMPLEMENTED_PENDING_REVIEW`

- Branch/base: `fix/635-design-artifact-url` from `origin/main@c40618688dd874e80aea8817e4c47e6615a0c3c0`.
- Final HEAD: the single atomic commit containing this report; exact remote readback is in the leader handoff.
- PR/merge/issue closure: not performed; not authorized.

## Delivery

- Added canonical `resolveDesignArtifactUrl`: root-relative grants resolve against the backend origin, never the complete `/api` base; only HTTP(S), same-origin `/api/design-artifacts/` URLs pass.
- Preview authorization uses that boundary. Authorization, invalid grant, byte-load error/retry, and no-preview remain observable; `onError` replaces a broken image and retry requests a fresh grant.
- Explicit access synchronously reserves a tab, then navigates it after authorization and validation. Popup, authorization, and navigation failures are reported instead of failing silently.
- Extended the existing browser scenario to publish real model/manifest/preview artifacts and GET every signed URL through Go + PostgreSQL + filesystem before verifying the PNG in Chromium.

## Evidence

- Baseline `./init.sh`: PASS (TypeScript, Go/PostgreSQL, Ruby/RBZ).
- Focused resolver/component: 36/36 PASS.
- `pnpm --filter @granete/ui test`: 159 files / 1,658 tests PASS.
- `pnpm typecheck`: 7/7 workspace projects PASS.
- `scripts/organization-browser-gate.sh tests/organization/project-designs.spec.ts`: 1/1 PASS; signed preview PNG, manifest JSON, and model SKP GETs were non-empty/non-404 with no `/api/api`.
- `git diff --check`: PASS.

Files: `designArtifactUrl.ts` + test, `ProjectDesignsScreen.tsx` + test, existing `project-designs.spec.ts`, and progress reports.

No backend/OpenAPI/storage/publication/migration, WebGL/SKP viewer, naming/material, machine-output, or ledger change. Rollback: revert this one commit.

## Independent review correction — PR #636

Resolved `CHANGES_REQUIRED` from `review_635_pr636_81a878d2.md` in the single allowed correction round:

- Artifact authorization rejection, invalid grant, blocked popup, popup closed during authorization, navigation failure, and preview byte-load failure now have distinct states and actionable copy.
- Component regressions assert each state, `popup.closed`, throwing `location.replace`, fail-closed cross-origin grants, `img.onError`, and whether the reserved tab closes.
- Preview error icons use the required `strokeWidth={1.5}`.
- The browser smoke captures both invalid-grant/retry and byte-load/retry cards at 390, 768, and 1280 pixels as Playwright attachments. Its first responsive run exposed a 438px card at 390px; `min-width: 0` on the existing inspector flex/card boundary corrected the overflow, and the re-run passed all six captures.

Correction evidence: focused resolver/component 40/40 PASS; full UI 159 files / 1,662 tests PASS; monorepo typecheck PASS; Go+PostgreSQL+Chromium browser gate 1/1 PASS with six responsive screenshot attachments; `git diff --check` PASS. The first visual run failed only on the newly added width assertion and is not claimed green.
