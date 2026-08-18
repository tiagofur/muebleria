-- Fase 3b — Compras/Almacén: live stock balance per catalog material.
-- One row per kind (herrajes/tableros/cintillas) × material_id. The balance
-- is derived from stock_movements (ledger); this table is the mutable cache
-- plus the minimum-stock alert threshold.
CREATE TABLE IF NOT EXISTS material_stock (
    kind        TEXT NOT NULL CHECK (kind IN ('herrajes','tableros','cintillas')),
    material_id TEXT NOT NULL,
    quantity    NUMERIC NOT NULL DEFAULT 0,
    min_stock   NUMERIC NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (kind, material_id)
);
