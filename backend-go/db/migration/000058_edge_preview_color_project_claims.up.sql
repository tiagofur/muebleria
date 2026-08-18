-- F095 (Fase 5.1+5.2, plan JD 2026-08-18 — production-module.md §8 D9/D10):
-- 1) Edge band color for "metros por color" edge-banding summaries (D10).
-- 2) Project-level operator claims: item_id NULL = claim de obra × estación (D9).
--    Existing rows keep their per-item values untouched.

ALTER TABLE edge_bands
  ADD COLUMN IF NOT EXISTS preview_color TEXT;

ALTER TABLE production_activities
  ALTER COLUMN item_id DROP NOT NULL;
