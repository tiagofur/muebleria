# #642 — Preserve pricing context when requoting from a published design

## Objective

Make `Nueva cotización desde Q1 ↔ R1` create draft Q2 after R1 changes a commercial material on a preset-bearing module, without mutating Q1 or weakening exact QuoteRevision authority.

## Problem and evidence

The normal Chrome + SketchUp flow reached accepted Q1 and published R1, then `POST /projects/{projectId}/quote-revisions:requote` returned `409`. Q1 had exact `measure_preset_id` and `base_mode`, but `buildRequoteCommercialSnapshot` rebuilt a pricing item from R1 while dropping that immutable commercial context. The resolver rejected the preset-bearing module before Q2 could be frozen.

## Scope

- Freeze per-unit preset, base treatment, structure pin, effective project-level material choices, and effective kitchen-layout base values in Q1's canonical commercial snapshot.
- Carry that Q1 context into Q2 while overlaying only selected R1 materials and dimensions.
- Add a real PostgreSQL regression proving Q1 immutability and successful Q2.
- Keep legacy snapshots readable; fail closed when a preset-bearing requote needs context they lack.

## Non-goals

- No preset inference from dimensions and no mutable `project_items` fallback as historical authority.
- No PTX, production, stock, tax/discount, UI, or SketchUp feature work.
- No merge or issue closure. Push and one issue-scoped PR are authorized.

## Authorized scope

Authorized by the P0 recovery request and the user's report that this failure blocks a demonstrable flow. Issue #642 is open and approved; #398 remains the integrated regression gate.

## TDD and verification

- Mode: strict TDD from repository `AGENTS.md`.
- Runner: isolated PostgreSQL in `muebles-p0-398b-postgres`; `GOFLAGS=-p=1`, `-parallel=1`.
- RED: `go test ./internal/storage -run '^TestQuoteCommercialSnapshot_Q2Requote_PreservesFrozenPricingContext$' -count=1 -parallel=1` failed with `elegí un preset de medida para el mueble "Gabinete CS" (CS-MOD)`.
- GREEN: the same regression passed; it asserts exact Q1 bytes/status, Q2 material totals/provenance, and serialized pricing context.
- REFACTOR: quote/design adjacent storage tests, requote API tests, domain/engine tests, OpenAPI drift, and full serialized storage suite passed.
- Correction RED: after advancing the structure from rev1 to rev2, Q2 drifted to `materials=432 / sale=848`; after deleting the current preset or changing the current base default, both legacy-context requotes incorrectly returned `nil` instead of `ErrQuoteCommercialSnapshotMissing`.
- Correction GREEN: `DATABASE_URL=<fresh-isolated> GOFLAGS='-p=1' go test ./internal/storage -run '^TestQuoteCommercialSnapshot_Q2Requote_(PreservesFrozenPricingContext|LegacyPricingContextFailsClosedAfterCatalogMutation)$' -count=1 -parallel=1` passed.
- Correction REFACTOR: adjacent storage/API/domain/engine suites and `python3 scripts/check_openapi_drift.py` passed; `GOFLAGS='-p=1' go test -p 1 -timeout=30m ./internal/storage -parallel=1` passed in 250.648s against `muebles_requote_642_green`, then that isolated DB was removed.

## Delivery

- Strategy: `ask-on-risk`; final pre-commit authored count: 391 lines including this artifact, below 400.
- Size exception: explicitly authorized by the user for one atomic PR; correction work may take the accumulated branch above 400 authored lines.
- Final accumulated authored count before the correction commit: 534 lines (+513/-21) from `origin/main`; the authorized exception keeps this one atomic PR.
- Branch/base: `fix/642-requote-pricing-context` from `origin/main@57ebd1b7ca7407128471d4e4f7b104de50f29c8f`.
- Commit identities: `a41c78a081789a0fdfb4a64c7bd50ed2b2cb2ce6` and correction `77df345b8905139de5f62e3499347d86c177d6bb`.
- RDD: clone-local disabled/unmanaged.

## Tasks

- [x] **T1 — Reproduce and preserve requote pricing context** *(corrected after independent review at `a41c78a081789a0fdfb4a64c7bd50ed2b2cb2ce6`)*
  - Route: delegated direct; 2+ non-trivial implementation files required one sole writer.
  - Added the focused PostgreSQL regression before production changes and observed RED.
  - Preserved immutable per-unit pricing context; R1 overlays remain explicit and bounded.
  - Evaluated project choices and kitchen layout: valid project defaults and effective base geometry are frozen per unit, so no separate project-level contract decision is needed for #642.
  - Verified legacy preset snapshots fail closed with the typed missing-snapshot path.
  - Evidence: focused/adjacent checks and full `./internal/storage` passed; Q1 remains byte/status immutable.
  - Correction round: freeze an effective structure revision when Q1 used a live/nil pin, and reject every legacy unit missing immutable pricing context without consulting current preset/base catalog state.
  - Fixed/context-free units now freeze explicit structure-independent evidence; an absent pin without that evidence fails closed.
  - Correction commit identity: this work-unit's `fix(quotes): close requote authority gaps` commit (exact SHA reported at handoff).

## Progress

T1 and its single bounded correction round are complete locally. Fresh independent review approved exact source HEAD `77df345b8905139de5f62e3499347d86c177d6bb`; the subsequent task-artifact-only publication update is structurally read back. Engram mirror is pending because multiple active runtime sessions make project binding ambiguous.

## Next step

Push the authorized branch, open one `Refs #642` / `Delivery: partial` PR with the explicit size exception, then observe exact-head CI. Do not merge or close #642/#398.
