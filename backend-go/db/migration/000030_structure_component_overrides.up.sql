-- Structure instance spatial/formula overrides (JD residual / furniture P0).
-- module_components already has overrides JSONB (000019); structure_components
-- only had placement_override. Domain ComponentInstance.Overrides already exists.
ALTER TABLE structure_components
    ADD COLUMN IF NOT EXISTS overrides JSONB;
