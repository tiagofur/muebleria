# #790 — PTX HPP250/CAD4 receiver policy

Issue: #790
Branch: `feat/790-ptx-hpp250-cad4-receiver`
Base: `origin/main@ffbdfe24de7153ed0e47c982fc30941b0039a013`

## Scope

Implement the lab-only receiver-specific policy for Client A HOLZMA HPP 250 / CADLink → CADmatic 4 covering MATERIALS, BOOK/MAX_BOOK, kerf/trims/RULES, BOARDS/JOBS/PATTERNS/CUTS shape, record order, docs, and verification. Do not publish a productive r5 profile, adapter identity, routing, `.RLT`, field pack, or client candidate.

## Tasks

- [x] Map current PTX compiler/parser/serializer and r2/r3/r4 invariants.
- [x] Add typed receiver policy model and lab policy constant.
- [x] Apply policy in `compileCutPlanToPtxDocument` behind explicit option only.
- [x] Extend BOARDS optional shape without inventing COST values.
- [x] Add receiver verifier/readback gates for MATERIALS/PATTERNS/order/shape.
- [x] Add tests for #790 required cases and mutation gates.
- [x] Document receiver field authority and update short pointers.
- [x] Run focused implementation/test/doc verification commands.
- [ ] Resolve blocked affected verification once isolated `DATABASE_URL` is available.
- [ ] Publish one PR after a PR exists.

## Evidence

- 2026-09-19 documentation-only receiver policy update: created `docs/machines/ptx-cadmatic4/10_receiver_profile_hpp250_cad4.md`, updated README pointer and `docs/verification.md` #790 entry.
- Implementation mapping completed across PTX compiler/parser/serializer, r2/r3/r4 invariants, receiver policy, compiler option wiring, BOARDS optional trailing shape, receiver readback gates, and focused mutation/contract tests.
- Receiver doc synchronized after implementation: `BOARDS.COST` and `STK_FLAG` are optional trailing shape fields only; compiler/receiver policy does not invent or emit default values. `COST` remains `UNKNOWN` for emitted value authority; `STK_FLAG` remains `UNKNOWN`/shape-only.
- Receiver doc synchronized after implementation: trim coherence gate blocks compilation when currently projected r3 trim slots `TRIM_FRIP`/`TRIM_VRIP`/`TRIM_FXCT`/`TRIM_VXCT` have defined executed geometry values that differ from receiver policy. `TRIM_HEAD`/`TRIM_FRCT`/`TRIM_VRCT` are receiver overrides, not geometry-derived in #790.
- `python3 scripts/factory_preflight.py` → `PREFLIGHT_OK_NOT_VERIFIED`; tests NOT_RUN; dirty tree included pre-existing source/test changes outside the documentation-only sync.
- Final implementation/test/doc evidence recorded: implementation, test, and documentation task items are complete; PR publication remains pending until a PR exists.
- `pnpm --filter @granete/excel test` → PASS; 46 files / 554 passed + 3 skipped.
- `pnpm typecheck` → PASS.
- `git diff --check` → PASS.
- Independent verifier → APPROVED.
- `python3 scripts/verify_affected.py --base origin/main --plan` → selected full major jobs.
- `python3 scripts/verify_affected.py --base origin/main --budget-seconds 3600` → BLOCKED because isolated `DATABASE_URL` was missing.
- Focused correction round after PR #801 CHANGES REQUESTED: made receiver policy executable/generic, moved HPP250 facts to `receiverPolicy.ts`, emitted TRIM_FRIP/VRIP/FXCT/VXCT from executed geometry only, omitted HEAD/FRCT/VRCT, gated BOOK/MAX_BOOK coherence by policy flag, added readback mutation checks for RULE1..4/KERF/BOOK/MAX_BOOK, and compared R2201/R7301 observed evidence vs emitted policy.
- `pnpm --filter @granete/excel test -- compileCutPlan.receiverPolicy.test.ts externalDialect.test.ts specPreflight.test.ts cutPlanPtxGoldenR4.test.ts cutPlanPtxGoldenR3.test.ts cutPlanPtxGolden.test.ts` → PASS; 46 files / 559 passed + 3 skipped.
- `pnpm --filter @granete/excel test` → PASS; 46 files / 559 passed + 3 skipped.
- `pnpm typecheck` → PASS.
- `git diff --check` → PASS.
