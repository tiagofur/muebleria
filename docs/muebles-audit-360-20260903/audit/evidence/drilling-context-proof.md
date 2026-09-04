# FM-03 — first-owner drilling reuse reproduced

One audit-only differential test passed with real `resolveProjectDrilling` and the existing `plantillaDemo` catalog. Passing reproduces the defect; it does not fix it.

Two lines share `MOD-GAB-01` but use custom dimensions:
- A: 300 × 720 × 590 mm.
- B: 800 × 1000 × 450 mm.

Each line resolves to eight patterns independently; together there are sixteen. B's 997 × 796 mm door independently has **three Ø35 hinge cups**. With item order A→B, the same-sized door receives **two cups** and the earlier line's hinge positions. Reversing order B→A restores B's exact independent hole list. Neither compared door result uses heuristic fallback.

B's 769 × 450 mm floor has zero issues independently and six issues after A→B resolution. Full normalized independent/combined/reversed outputs and links are saved in `drilling-context-observation.json`.

This proves first-part-owner reuse across **different custom-dimension cache keys** that share expanded part IDs. It does not independently isolate the separate omission of measure preset or option choices from the cache key.

- Summary: `data/drilling-context-proof.json`.
- Test: `proofs/drilling-context.test.ts`.
- Log: `evidence/drilling-context-proof.log`.
- Reproduce from source: `pnpm exec vitest run --config ../audit/proofs/drilling-context-vitest.config.mjs`.

No UI, API, database, generated DXF, SketchUp host, machine readback, customer data or physical damage was tested. Product source remains unchanged.
