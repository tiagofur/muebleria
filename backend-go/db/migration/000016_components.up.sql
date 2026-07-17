-- F050 / #101: Reusable engineering components (piezas de carcasa).
-- Flat catalog entity — no child tables, no JOINs needed.
-- Mirrors the frontend Component type from @muebles/domain.

CREATE TABLE IF NOT EXISTS components (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    placement VARCHAR(50) NOT NULL DEFAULT 'base',
    geometry_kind VARCHAR(50) NOT NULL DEFAULT 'rectangular_board',
    length_mm INT NOT NULL CHECK (length_mm > 0),
    width_mm INT NOT NULL CHECK (width_mm > 0),
    thickness_mm INT NOT NULL CHECK (thickness_mm > 0),
    default_edges JSONB NOT NULL DEFAULT '[]'::jsonb,
    option_roles TEXT[],
    notes TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
