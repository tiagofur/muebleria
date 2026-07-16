-- F044 / COST-02: workshop settings (taller-wide), incl. vendedor cost visibility.

CREATE TABLE IF NOT EXISTS workshop_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    default_margin_factor DOUBLE PRECISION NOT NULL DEFAULT 1.35,
    default_labor_fixed_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
    default_currency TEXT NOT NULL DEFAULT 'MXN',
    vendedor_can_view_costs BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO workshop_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
