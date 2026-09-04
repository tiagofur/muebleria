# FM-01 — pure-domain template loss reproduced

Three audit-only tests passed against the pinned production domain functions. Passing means the existing defect was reproduced, not fixed.

- `projectToTemplate` drops all six configured fields: `spaces`, `activeSpaceId`, `baseClearanceMm`, `wallCabinetZMm`, `showCountertop`, `countertopMaterialId`.
- `createProjectFromTemplate` independently drops these fields even when supplied with a complete template.
- A two-space round-trip returns only top-level walls and placements. Both project items remain, and the active placement is remapped to its fresh item ID; the inactive space configuration is absent.

Expected versus actual values: `data/template-roundtrip-proof.json`.
Execution: `evidence/template-roundtrip-proof.log` (3/3 tests).
Reproduce from `source`: `pnpm exec vitest run --config ../audit/proofs/template-vitest.config.mjs`.

Limits: synthetic fixture using the real functions. No UI, store persistence, API, database, SketchUp, or actual customer data was involved. This does not prove the complete save/create/reload journey. Product source remains untouched. No F128 test was attempted.
