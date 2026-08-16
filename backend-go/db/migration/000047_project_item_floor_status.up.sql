-- PROD-3.1 / RN parity: shop-floor status per line item. Additive; NULL =
-- pending (legacy rows). Previously floor_status lived only in the TS
-- client and was silently dropped on every project save.
ALTER TABLE project_items
  ADD COLUMN IF NOT EXISTS floor_status TEXT;
