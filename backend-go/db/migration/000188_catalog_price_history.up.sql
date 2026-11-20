-- #1651: actualización masiva de precios del catálogo de la fábrica.
--
-- catalog_price_history is the append-only record of every price change
-- applied by a bulk update (percent adjustment or supplier price list): the
-- old and new price, the exact resource, the batch, the actor and the real
-- time the change was applied. Rows are never edited or deleted; accepted
-- QuoteRevisions keep their frozen commercial snapshots and are not touched
-- by any price change.
--
-- resource_kind maps to the priced column:
--   material → material_boards.board_price (cost_per_m2 is generated from it)
--   edge     → edge_bands.cost_per_ml
--   hardware → hardwares.cost_per_unit

CREATE TABLE IF NOT EXISTS catalog_price_history (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id),
    batch_id UUID NOT NULL,
    resource_kind TEXT NOT NULL CHECK (resource_kind IN ('material', 'edge', 'hardware')),
    resource_id UUID NOT NULL,
    resource_code TEXT NOT NULL,
    old_price NUMERIC(14, 2) NOT NULL CHECK (old_price >= 0),
    new_price NUMERIC(14, 2) NOT NULL CHECK (new_price >= 0),
    source TEXT NOT NULL CHECK (source IN ('percent', 'import')),
    note TEXT NULL CHECK (note IS NULL OR char_length(note) <= 500),
    changed_by UUID NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalog_price_history_resource
    ON catalog_price_history (organization_id, resource_kind, resource_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_catalog_price_history_batch
    ON catalog_price_history (batch_id);

ALTER TABLE catalog_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_price_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS catalog_price_history_read ON catalog_price_history;
DROP POLICY IF EXISTS catalog_price_history_insert ON catalog_price_history;
CREATE POLICY catalog_price_history_read ON catalog_price_history FOR SELECT
    USING (organization_id = app_current_organization_id());
CREATE POLICY catalog_price_history_insert ON catalog_price_history FOR INSERT
    WITH CHECK (organization_id = app_current_organization_id());

GRANT SELECT, INSERT ON catalog_price_history TO granete_app;
REVOKE UPDATE, DELETE ON catalog_price_history FROM granete_app;

INSERT INTO rls_policy_inventory
    (table_name, classification, read_scope, write_scope, rationale)
VALUES
    ('catalog_price_history', 'append-only', 'organization', 'insert-only-organization',
     'Price change history of the factory catalog (#1651): append-only, organization-private; records old/new price, batch, actor and real change time')
ON CONFLICT (table_name) DO UPDATE SET
    classification = EXCLUDED.classification,
    read_scope = EXCLUDED.read_scope,
    write_scope = EXCLUDED.write_scope,
    rationale = EXCLUDED.rationale,
    policy_version = rls_policy_inventory.policy_version + 1,
    updated_at = NOW();
