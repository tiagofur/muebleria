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
- [ ] T2 — Add authoritative React projection states and focused browser proof, under #642, using the generated API; preserve all authority and add focused browser proof. Route: delegated; trigger: 2+ non-trivial files. Evidence: pending.

## Next step
T2 delegated writer: add a read-only, authority-preserving projection panel in `ProjectDesignsScreen` with focused unit and Chromium+Go+throwaway-PostgreSQL proof. TDD: strict; run observed RED, GREEN, REFACTOR. No source write has occurred.
