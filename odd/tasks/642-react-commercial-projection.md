# #642 React CommercialProjection — ODD execution

## Objective
Restore the earliest unproven Digital Thread surface identified in the end-to-end audit: show authoritative CommercialProjection in the normal React design flow without creating revisions or locally calculating price.

## Problem
At `origin/main@a609a1d1c47b436a81e431b89b1a7cd276c2b2f0`, the backend and SketchUp HUD consume CommercialProjection, but no React consumer or browser proof was found. This is a user-visible gap before the quote/release journey.

## Scope and constraints
- Authorized source issue: #642 (`status:approved`). #677 is the completed SketchUp HUD owner and is excluded.
- Do not change CommercialProjection authority, create Q/R/P implicitly, or alter SketchUp behavior.
- Throwaway PostgreSQL only; no persistent database.
- Exact base: `origin/main@a609a1d1c47b436a81e431b89b1a7cd276c2b2f0`.
- Delivery strategy: single-pr; forecast: 250 authored changes.
- TDD mode: enabled by repository instruction; runner to be resolved by delegated writer.

## Tasks
- [x] T1 — Verify ownership and map the smallest React surface for authoritative CommercialProjection. Route: delegated; trigger: preparation and expected multi-file change. Evidence: PR #702 delivered backend/SketchUp only; `getDesignCommercialProjection` has no React runtime caller. #642 authorizes remaining commercial consumers. Engram mirror: pending (Engram rejected writes because multiple active runtime sessions match the project directory).
- [x] T2 — Add authoritative React projection states and focused browser proof, under #642, using the generated API; preserve all authority and add focused browser proof. Route: delegated; trigger: 2+ non-trivial files. Evidence: strict TDD RED observed with `pnpm --filter @granete/ui test -- ProjectDesignsScreen.test.tsx` (new #642 assertion failed: missing `commercial-projection-panel`); GREEN/REFACTOR observed with `pnpm --filter @granete/ui exec vitest run src/digitalThread/ProjectDesignsScreen.test.tsx` (59 passed) and `pnpm --filter @granete/ui typecheck` (passed). V0: `git diff --check` passed; `python3 scripts/verify_affected.py --base origin/main --plan` selected broad repository gates because it classified the input as global/tooling/unknown, so no false full-suite claim is made. V2: `scripts/organization-browser-gate.sh tests/organization/prequote-design.spec.ts` passed (Chromium + Go + disposable PostgreSQL; 2 passed), including an actual 200 `commercial-projection` response with `status=incomplete`, rendered read-only panel, and readback confirming no QuoteRevision creation before explicit Q1.

## Review evidence
Fresh reviewer `/root/projection_verify` inspected `5609323806b3219e8a34521702c1c75d7ab4bf54` against `origin/main@a609a1d1c47b436a81e431b89b1a7cd276c2b2f0`: no source defect found; independent focused Vitest passed 59/59. V2 browser evidence was not independently rerun; no PR, remote CI, approval, or merge has occurred.

## Next step
Open a PR only on explicit user request, then run one exact-HEAD CI and independent review under ordinary repository policy.

## Remote CI correction
Remote TypeScript CI on `27f7d5fac1ad8b4972747e88bd31b3e045b1c3ec` failed only because the CSS token guard interpreted the source comment `#642` as a hard-coded hex value. Commit `9325338940c92518282038022fa69349ed4513db` reworded that comment without changing behavior. A fresh reviewer then ran `pnpm test`: PASS, 176 files / 1,985 tests, including the former guard. Remote CI remains the exact-head authority.
