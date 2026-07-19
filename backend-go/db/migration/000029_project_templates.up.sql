-- #110 / H15: reusable project templates.
-- Each template is a recipe (no customer/status/snapshot): items + project
-- level choices + measure defaults + kitchen layout + installation checklist +
-- default currency/margin/labor. "Crear desde plantilla" clones a fresh draft
-- Project from one of these (clone logic lives in the TS domain).
--
-- Items are stored as a JSONB column (mirroring how the FE sends them and how
-- the kitchen_layout/measure_defaults blobs already live on projects), avoiding
-- a parallel project_template_items table.

CREATE TABLE IF NOT EXISTS project_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'MXN',
    margin_factor DOUBLE PRECISION NOT NULL DEFAULT 1.35,
    labor_fixed_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
    project_level_choices JSONB,
    measure_defaults JSONB,
    kitchen_layout JSONB,
    installation_checklist JSONB,
    items JSONB NOT NULL DEFAULT '[]',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
