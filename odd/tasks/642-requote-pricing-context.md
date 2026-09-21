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
- No merge, issue closure, push, PR, or GitHub mutation.

## Authorized scope

Authorized by the P0 recovery request and the user's report that this failure blocks a demonstrable flow. Issue #642 is open and approved; #398 remains the integrated regression gate.

## TDD and verification

- Mode: strict TDD from repository `AGENTS.md`.
- Runner: isolated PostgreSQL in `muebles-p0-398b-postgres`; `GOFLAGS=-p=1`, `-parallel=1`.
- RED: `go test ./internal/storage -run '^TestQuoteCommercialSnapshot_Q2Requote_PreservesFrozenPricingContext$' -count=1 -parallel=1` failed with `elegí un preset de medida para el mueble "Gabinete CS" (CS-MOD)`.
- GREEN: the same regression passed; it asserts exact Q1 bytes/status, Q2 material totals/provenance, and serialized pricing context.
- REFACTOR: quote/design adjacent storage tests, requote API tests, domain/engine tests, OpenAPI drift, and full serialized storage suite passed.

## Delivery

- Strategy: `ask-on-risk`; final pre-commit authored count: 391 lines including this artifact, below 400.
- Branch/base: `fix/642-requote-pricing-context` from `origin/main@57ebd1b7ca7407128471d4e4f7b104de50f29c8f`.
- Commit identity: this work-unit's `fix(quotes): preserve requote pricing context` commit (exact SHA reported at handoff).
- RDD: clone-local disabled/unmanaged.

## Tasks

- [x] **T1 — Reproduce and preserve requote pricing context**
  - Route: delegated direct; 2+ non-trivial implementation files required one sole writer.
  - Added the focused PostgreSQL regression before production changes and observed RED.
  - Preserved immutable per-unit pricing context; R1 overlays remain explicit and bounded.
  - Evaluated project choices and kitchen layout: valid project defaults and effective base geometry are frozen per unit, so no separate project-level contract decision is needed for #642.
  - Verified legacy preset snapshots fail closed with the typed missing-snapshot path.
  - Evidence: focused/adjacent checks and full `./internal/storage` passed; Q1 remains byte/status immutable.

## Progress

T1 is complete locally. Engram mirror is pending because multiple active runtime sessions make project binding ambiguous.

## Next step

Parent orchestration may independently inspect this exact commit, then decide push/PR under ordinary repository policy.
