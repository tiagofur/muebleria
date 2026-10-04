# Executable audit-only proofs

These tests deliberately assert observed unsafe behavior at pinned main `316df57c7c3c9d5470b5a3f22b39fffeacfd7676`. **Passing means reproduced, NOT fixed or production-safe.**

## Run

```sh
cd /Users/tiagofur/dev/carpinteria/muebles-audit-360-20260903/source
pnpm exec vitest run --config ../audit/proofs/vitest.config.mjs --reporter=verbose
```

Config, fixtures, test harness, Vitest cache and output artifacts are under sibling `audit/`; imports execute original source. No DB is involved.

## Evidence

- `../evidence/defect-proofs.log`: final run, 3 passed, exit 0.
- `../data/defect-proofs.json`: observed results, source hashes, scope and limitations.
- `../evidence/defect-dxf-{normal,rotated}.dxf`: actual generated outputs, same input front hole, 1 vs 0 CIRCLE.
- `../evidence/defect-drilling-provenance.json`: full resolved output vs exported payload; 7 fallback flags lost. The fixture has zero actual geometry issues; this does NOT prove runtime loss of a nonempty issue list.
- `../evidence/defect-picking-partial-failure.json`: mocked repository trace, 10→8→6 after two failed picking persists; no compensating movement.

The DXF fixture is copied from the existing exporter test function and narrowed to one no-grain piece. The drilling fixture removes only optional machining profiles while retaining required hardware references. Initial invalid fixture attempt removed those references entirely, so BOM correctly rejected it; its log remains `defect-proofs-first-attempt.log`.

Picking mocks are explicit: repository controls fake balances/failures; toast/workspace imports are isolated. This is a real store orchestration test, not backend transaction, RLS, HTTP or database integration evidence. DXF output is not CAM/machine readback.
