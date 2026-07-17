-- F054 / #102: Composed modules — link a module to a structure and to its own
-- reusable component instances. A module is now composed of a structure body
-- (EST-…) plus module-level component instances (doors, shelves, …), instead of
-- carrying flat board_parts. Plain modules keep their board_parts for now
-- (dual path); this migration only ADDS composition support.

-- Reference a structure (engineering body) from a module. Nullable: a module
-- without a structure is a legacy/flat module.
ALTER TABLE modules ADD COLUMN IF NOT EXISTS structure_id UUID REFERENCES structures(id) ON DELETE SET NULL;

-- Component instances placed directly on a module (doors, drawers, …), beyond
-- those inherited from its referenced structure. Mirrors ModuleComponentInstance
-- from @muebles/domain/types.ts (componentId + quantity + placementOverride +
-- optional edge overrides). length_formula / width_formula allow per-instance
-- parametric overrides (Fase 3).
CREATE TABLE IF NOT EXISTS module_components (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    module_id          UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    component_id       UUID NOT NULL REFERENCES components(id),
    quantity           INT NOT NULL CHECK (quantity > 0),
    placement_override VARCHAR(50),
    length_formula     VARCHAR(100),
    width_formula      VARCHAR(100),
    overrides          JSONB,
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_module_components_module_id
    ON module_components(module_id);
