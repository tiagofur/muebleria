# 793 PTX r5 profile, industrial identity and final pre-field gate

Issue: #793 — [P0][PTX-CAD4][R5-F] Integrar profile r5, nueva identidad industrial y gate final antes de campo
Base: origin/main @ fbe8227d6f5ed166b9ddc0625ada15e9a8469232 (merge PR #804 / #792)
Branch: feat/793-ptx-r5-productive-gate
Status: implemented pending PR/CI

## Scope

- New revision `ptx-cadmatic-4@r5` (PTX_CADMATIC_4_R5_PROFILE, digest 3d3d215b…): r4 dimension base + strictSpecPreflight pattern-exchange-v1, partsReqDimensionPolicy part-local-pre-rotation-cut, partsUdi structural, receiverPolicy HPP250-CAD4-R5-CANDIDATE. r2/r3/r4 digests untouched.
- Productive receiver policy `HPP250_CAD4_R5_CANDIDATE_RECEIVER_POLICY` (id HPP250-CAD4-R5-CANDIDATE; #790 values; LAB policy frozen).
- Adapter `granete-ptx@1.4.0` (implementationDigest 8c13f67b…): explicit isCadmatic4R5 branch + PTX_COMPILER_R5_REQUIRED_DIMENSIONS; TITLE GRANETE-R5-FIELD-TEST (21 ≤ 25); serialize ONLY via serializePtxDocumentBytesSpecChecked; partLabels from frozen authority; hard gates (label_authority_missing, 1:1 coverage, release_identity_missing/mismatch, cncScope derivation) — no r4/ptx-generic/legacy fallback. 1.3.0 identity preserved (PTX_ADAPTER_1_3_0_HISTORICAL_IDENTITY; stale pins never retarget).
- Productive label authority: domain-neutral ManufacturingLabelProjection (+ManufacturingMachiningAuthority, manufacturingCncScope from releaseBase fingerprint; shared frozen iteration with releaseCutRowsFromDemand; -C<n> discipline) → ResolvedCuttingJob.manufacturingLabels → excel ptxPartLabelsFromManufacturingProjection (only sanctioned producer) → PARTS_INF/UDI. CNC only with explicit authority; room/ORDER honest (empty / R<releaseNumber>).
- Route: generateSelectedCuttingOutput(…, { manufacturingLabels }) with catalog-level + labeled-job gates; by-material subsets. Release web flow forwards the projection (ShellView → EngineeringWorkspace → panel → useExportHandlers). UI keeps candidate copy (NOT_TESTED).
- Catalog CURRENT r5 + adapter 1.4.0: contract JSON, Go mirror, Go test fixtures, KNOWN_OUTPUT_PROFILES (r4 constant stays for history/tests).
- Tests: digests exact (profile+adapter+1.3.0 evidence), routing/title/spec-preflight/receiver values, labels/EDGE mapping/PRODUCT/PROD_NUM/BARCODE2, CNC deterministic + cross-release scope + missing-scope block, part-local dims on rotated piece, no-fallback, stale r4/1.3.0 pins, E2E productive (bytes→parse→preflight→readback→field pack real pins), goldens r2/r3/r4/r5-LAB byte-unchanged.
- Browser: machine-output-selection (r5 pin + candidate copy + fail-closed export without authority) and engineering-cutting-demand (release flow exports r5 bytes with PARTS_INF/UDI, manifest provenance, independent readback) — require the org gate (isolated DATABASE_URL).
- ONE final-review field pack via env-gated generator (r5ReviewFieldPack.generate.test.ts, skips in CI) into ignored artifacts-local/ptx-r5-final-review/ (GC238DCD30E18.ptx, sha 6e40939c…, 2284 bytes; JOBS 1/PARTS 7/PARTS_INF 7/PARTS_UDI 7/BOARDS 3/MATERIALS 2/OFFCUTS 1/PATTERNS 3/CUTS 15; NOT_TESTED/notClaimed). No send, no private data.
- Docs 13_final_r5_candidate_gate.md + pointers README/07/12 + .gitignore artifacts-local.

## Exclusions

No merge, no self-approval, no CADLink execution, no .SAW, no client send, no supportStatus promotion (#348 owns field results), no golden #791 change (239e9f7c…/3303 bytes intact), no r2/r3/r4 byte changes, no closed-semantics changes, no opportunistic refactors, no progress/current.md cleanup.

## Tasks

- [x] Startup: fetch main (fbe8227d), preflight OK, issue approved/unassigned, no existing PR.
- [x] Domain neutral projection + CNC scope + ResolvedCuttingJob extension.
- [x] Excel r5 profile/policy/adapter/routing/spec-checked serialize/no-fallback + fixture.
- [x] Productive route labels + UI wiring + candidate copy.
- [x] Catalog JSON + Go mirror + parity (TS↔JSON↔Go tests) + Go fixtures.
- [x] Tests (digests, routing, labels/CNC, E2E productivo, no-fallback, goldens) + browser specs updated.
- [x] Final-review field pack into artifacts-local + report.
- [x] Docs + pointers + .gitignore.
- [x] Local verification + PR + exact-head CI (see Evidence).

## Evidence

- Focused: `pnpm --filter @granete/excel test` → 50 files passed (639 passed | 4 skipped — generator skips without env). `pnpm --filter @granete/domain test` → 112 files / 1582 tests passed. `pnpm --filter @granete/ui test` → 175 files / 1968 tests passed.
- Typecheck: `pnpm typecheck` → passed across workspace.
- TS aggregate: `pnpm test` → exit 0 (web 41 files / 532 tests green).
- Go: `go build ./...` OK; `go test ./internal/domain/ ./internal/api/ ./internal/storage/` → ok (storage first run had a flake; two subsequent runs incl. `-count=1` green).
- Gates: `check_openapi_drift.py` OK; scripts unittests (ci 31 / efficiency 17 / contract 13) OK; `git diff --check` OK.
- Preflight: `factory_preflight.py` → PREFLIGHT_OK_NOT_VERIFIED.
- Selector: `verify_affected.py --base origin/main --plan` → broad gates (tooling/contracts touched); browser/foundation-postgres require isolated DATABASE_URL → delegated to exact-head CI.
- Review pack: generated with `GRANETE_R5_REVIEW_PACK_DIR=…/artifacts-local/ptx-r5-final-review` (report in docs 13 §6).
