# 792 PTX CADLink RLT parser and reproducible field pack

Issue: #792 — [P0][PTX-CAD4][R5-E] CADLink preflight, parser .RLT y field pack reproducible
Base: origin/main @ 9475da3a21b4ab13ca33f4a917babab86f0012ea (merge #802)
Branch: feat/792-cadlink-rlt-field-pack
Status: implemented pending PR/CI

## Scope

- Versioned CADLink error catalog from the primary source (V12 web help Cadlink.htm) with CAD3-specific scope for 18..21.
- Fail-closed typed `.RLT` parser (three integers, CRLF/LF, one final newline, no extra content).
- Granete diagnosis: field/line verbatim, documented meaning verbatim, PTX family derived only from candidate bytes, no invented field-name mapping, unknown codes preserved as UNKNOWN_ERROR.
- Deterministic field pack builder: PTX + manifest.json + expected_identity.json + README_FIELD_TEST.txt + CHECKSUMS.sha256 + optional real pictures; identity pins REQUIRED from caller (LAB_TEST_ONLY in tests).
- Fail-closed preflight pipeline reusing existing parse/validate/spec-preflight/readback/receiver-policy gates (no second verifier).
- README_FIELD_TEST with /CAD4 /RESULT /UDI /INF intent, cadlink.ini override warning (cadlinkIniPresent/effectiveOptionsVerified field report), no /DELETE, no physical cutting, RETURN THE .RLT.
- Field-result readback API analyzeCadlinkFieldResult for #793/#348 (never changes supportStatus).

## Exclusions

No productive r5 profile/adapter publication (ptx-cadmatic-4@r5 / granete-ptx@1.4.0 belong to #793), no profiles.ts/routing/supportStatus/compatibility changes, no CADLink execution in CI, no client PTX, no client data, no golden #791 modification (SHA 239e9f7c.../3303 bytes intact), no r2/r3/r4 byte updates, no visual label generation.

## Tasks

- [x] Map existing PTX pipeline pieces (#788 spec preflight, #789 labels/udiPictureRef, #790 receiver policy, #791 golden r5 + readback).
- [x] Implement cadlinkRlt.ts (parser + catalog V1 + classification + diagnosis).
- [x] Implement cadlinkFieldPack.ts (gates + deterministic pack + README + checksums + analyze API + pins mapper).
- [x] RLT tests (21) incl. required fixtures (bad format, illegal part/material index, CRLF/LF, malformed variants).
- [x] Field pack tests (29) incl. the 25 issue acceptance points and negative preflight mutations.
- [x] Export new API from @granete/excel index.
- [x] Docs: 12_cadlink_rlt_field_pack.md + pointers in README.md / 07_plan / docs/verification.md.
- [x] Run focused tests, full package suite, typecheck, diff hygiene, verify_affected plan.

## Evidence

- Preflight: `python3 scripts/factory_preflight.py` -> PREFLIGHT_OK_NOT_VERIFIED at 9475da3a (tools node/pnpm/go/ruby/docker OK).
- Focused: `pnpm --filter @granete/excel exec vitest run src/ptx/cadlinkRlt.test.ts src/ptx/cadlinkFieldPack.test.ts` -> 2 files, 50 tests passed.
- Package: `pnpm --filter @granete/excel test` -> 49 files passed, 627 tests passed, 3 skipped.
- Typecheck: `pnpm typecheck` -> passed across workspace packages (incl. apps/web, apps/mobile, packages/ui).
- Diff hygiene: `git diff --check` -> passed.
- Selector: `python3 scripts/verify_affected.py --base origin/main --plan` -> selected broad gates ("global, tooling or unknown input changed" — foreign untracked inputs in the worktree).
- Proportional runner: `python3 scripts/verify_affected.py --base origin/main --budget-seconds 900` -> BLOCKED before broad gates (isolated DATABASE_URL required for selected Go/PostgreSQL proofs), same as #791.
- TS aggregate: `pnpm test` -> passed (workspace TS tests; e.g. apps/web 41 files/532 tests; expected jsdom warnings and an intentional 409 concurrency-test console error in unrelated suites).
- Golden #791 consumed unmodified: pack PTX SHA `239e9f7c8989c5f3756545da94a184b7b79aa1bdda797755c065301917201932`, 3303 bytes (regression guarded by its own manifest test).
- LAB_TEST_ONLY pins used for all pack builds; no productive identity recorded; r2/r3/r4/r5-LAB untouched.
