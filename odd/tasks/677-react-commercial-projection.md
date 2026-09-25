# #677 React CommercialProjection — ODD execution

## Objective
Restore the earliest unproven Digital Thread surface identified in the end-to-end audit: show authoritative CommercialProjection in the normal React design flow without creating revisions or locally calculating price.

## Problem
At `origin/main@a609a1d1c47b436a81e431b89b1a7cd276c2b2f0`, the backend and SketchUp HUD consume CommercialProjection, but no React consumer or browser proof was found. This is a user-visible gap before the quote/release journey.

## Scope and constraints
- Authorized source issue initially assessed: #677 (`status:approved`), subject to issue-scope verification before implementation.
- Do not change CommercialProjection authority, create Q/R/P implicitly, or alter SketchUp behavior.
- Throwaway PostgreSQL only; no persistent database.
- Exact base: `origin/main@a609a1d1c47b436a81e431b89b1a7cd276c2b2f0`.
- Delivery strategy: single-pr; forecast: 250 authored changes.
- TDD mode: enabled by repository instruction; runner to be resolved by delegated writer.

## Tasks
- [ ] T1 — Verify ownership and map the smallest React surface for authoritative CommercialProjection. Route: delegated; trigger: preparation and expected multi-file change. Evidence: pending.
- [ ] T2 — Add authoritative React projection states and focused browser proof, if #677 scope explicitly authorizes the React surface; otherwise stop and report the correct owner gap. Route: delegated; trigger: 2+ non-trivial files. Evidence: pending.

## Next step
Delegate ownership/surface verification before any product source write.
