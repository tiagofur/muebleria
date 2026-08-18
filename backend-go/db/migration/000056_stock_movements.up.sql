-- Fase 3b — stock ledger: one immutable row per entry/exit/adjust/dispatch
-- (who/when/why). Same audit pattern as project_item_floor_events (F092):
-- balance_after snapshots the balance so the ledger is self-contained.
CREATE TABLE IF NOT EXISTS stock_movements (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kind          TEXT NOT NULL CHECK (kind IN ('herrajes','tableros','cintillas')),
    material_id   TEXT NOT NULL,
    type          TEXT NOT NULL CHECK (type IN ('entrada','salida','ajuste','despacho')),
    delta         NUMERIC NOT NULL,
    balance_after NUMERIC NOT NULL,
    project_id    UUID REFERENCES projects(id) ON DELETE SET NULL,
    note          TEXT,
    reverts_id    UUID REFERENCES stock_movements(id) ON DELETE SET NULL,
    by_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    by_name       TEXT,
    at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_material
    ON stock_movements(kind, material_id, at);
