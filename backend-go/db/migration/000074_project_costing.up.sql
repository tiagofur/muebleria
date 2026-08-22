-- OC-080..OC-084 (#304): job costing subprocess per project (cost baseline
-- frozen from quote snapshot + release, time entries, other actual costs) as a
-- JSONB column on projects, same convention as quality (000072). Material
-- actuals are NOT stored here: they derive from stock movements assigned to
-- the obra plus rework actions. Writes only through the dedicated costing
-- endpoints.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS costing JSONB;
