# 791 PTX CUTS r5 semantics differential golden

Issue: #791 — [P0][PTX-CAD4][R5-D] Corregir semántica CUTS 90..99 y crear differential/golden r5 contra muestras saneadas
Base: origin/main @ fa21d780960a2fb409f50971c49a0750369936fb (merge #801)
Branch: fix/791-ptx-cuts-r5
Status: implemented pending PR/CI

## Scope

- Separate CUTS.FUNCTION semantics from PART_INDEX/Xn references.
- Keep the receiver-evidenced r5 subset that emits FUNCTION 92 + Xn only for a real phase-2 trim/waste offcut event.
- Add independent semantic readback and mutation tests for orthogonality.
- Add property-level differential checks against sanitized R2201/R7301 samples.
- Generate a lab/test r5 golden through the real pipeline with deterministic manifest evidence.
- Preserve r2/r3/r4 historical bytes, profile digests, and adapter identities.

## Exclusions

No #792/.RLT, field pack, CADLink, client PTX, publication, productive r5 profile/adapter/routing/supportStatus, physical cutting, r2/r3/r4 byte updates, or invented pseudo-events.

## Tasks

- [x] Map existing PTX semantics, golden, differential, and profile infrastructure.
- [x] Implement the typed CUTS.FUNCTION semantic model and generic validation split.
- [x] Implement/refine independent r5 semantic verifier with function/reference mutation tests.
- [x] Add differential property tests for sanitized R2201/R7301 samples.
- [x] Generate deterministic lab r5 golden and manifest through the real pipeline.
- [x] Update r5 semantics documentation and historical errata/pointers.
- [x] Run focused regression, historical immutability, typecheck, verify_affected plan, and independent verifier.

## Evidence

- Preflight: `python3 scripts/factory_preflight.py --require node pnpm` -> PREFLIGHT_OK_NOT_VERIFIED at fa21d780960a2fb409f50971c49a0750369936fb.
- Focused/full package: `pnpm --filter @granete/excel test` -> 47 files passed, 577 tests passed, 3 skipped.
- Typecheck: `pnpm typecheck` -> passed across workspace packages.
- Diff hygiene: `git diff --check` -> passed.
- Selector: `python3 scripts/verify_affected.py --base origin/main --plan` -> selected broad gates because worktree includes global/unknown input.
- Proportional runner: `python3 scripts/verify_affected.py --base origin/main --budget-seconds 900` -> BLOCKED before running selected broad gates because isolated DATABASE_URL is required for selected Go/PostgreSQL proofs.
- TS aggregate: `pnpm test` -> passed (workspace TS tests; output contains expected jsdom/Three warnings from unrelated suites).
- Independent verifier: `gentle-ai-verify` approved scoped #791 candidate; no blockers.
- Golden r5 LAB/TEST: `packages/excel/src/ptx/cutPlanPtxGoldenR5.ts`; sha256 `239e9f7c8989c5f3756545da94a184b7b79aa1bdda797755c065301917201932`; byte length `3303`; records `60`; parts `10`; materials `2`; sheets `4`; offcuts `1`; PARTS_INF `10`; PARTS_UDI `10`; CNC drawings `9`.
