-- #1579: the door height -> quantity table a HINGE declares for itself
-- ({"bands":[{"upToHeightMm","hinges"}],"widthSurgeOverMm"}). Nullable JSONB:
-- NULL = no table, and the hinge inherits the factory policy, then the library
-- ladder — byte-identical for every existing row. Deliberately NO backfill: a
-- table seeded on existing hinges would outrank a factory policy and move
-- closed quotes, which re-resolve against pins with the live engine.
-- Keys are camelCase like `dimensions`, so the JSONB round-trips through the
-- API without key rewriting. Writes validate server-side (HINGE_DEMAND_INVALID
-- 422), not in the database.
ALTER TABLE hardwares ADD COLUMN IF NOT EXISTS hinge_demand JSONB;
