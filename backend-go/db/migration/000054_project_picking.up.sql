-- Fase 3 — Compras/Almacén: one row per project × material picking status.
-- Live state for the warehouse picking lists (herrajes/tableros/cintillas);
-- marked_at/marked_by give who/when each despacho happened (traceability).
CREATE TABLE IF NOT EXISTS project_picking (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    material   TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pendiente',
    marked_at  TIMESTAMPTZ,
    marked_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (project_id, material)
);

CREATE INDEX IF NOT EXISTS idx_project_picking_project
    ON project_picking(project_id);
