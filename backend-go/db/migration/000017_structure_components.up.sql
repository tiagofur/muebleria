-- F052: Structure component instances — composable modules within a structure.
-- Mirrors ModuleComponentInstance from @muebles/domain/types.ts.
CREATE TABLE IF NOT EXISTS structure_components (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    structure_id       UUID NOT NULL REFERENCES structures(id) ON DELETE CASCADE,
    component_id       UUID NOT NULL REFERENCES components(id),
    quantity           INT NOT NULL CHECK (quantity > 0),
    placement_override VARCHAR(50),
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
