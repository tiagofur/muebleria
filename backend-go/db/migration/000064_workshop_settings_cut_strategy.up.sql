-- F133: workshop-level default cut strategy for projects without a plan.
-- Additive: NULL/empty = saw-guillotine (normalizeWorkshopSettings fallback).
ALTER TABLE workshop_settings
  ADD COLUMN IF NOT EXISTS default_cut_strategy TEXT;
