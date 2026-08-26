-- ADR-0004 / #325: row-level scoping for business/transactional tables.
-- Existing rows belong to the initial organization (backfill 000081).
-- TRANSITIONAL: the column keeps a DEFAULT to the initial org so inserts that
-- do not carry a scope yet keep working between F169 and F170; F170 adds the
-- org-scoped auth context, scopes every write explicitly and drops this
-- default (fail-loud for unscoped writes from then on).
-- Cross-org sequence numbers (warranty tickets, purchase orders) become
-- unique per organization instead of globally.

ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_customers_organization ON customers(organization_id);

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_projects_organization ON projects(organization_id);

ALTER TABLE project_items
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_project_items_organization ON project_items(organization_id);

ALTER TABLE project_item_choices
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);

ALTER TABLE project_level_choices
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);

ALTER TABLE project_item_floor_events
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);

ALTER TABLE project_events
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_project_events_organization ON project_events(organization_id);

ALTER TABLE project_internal_messages
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);

ALTER TABLE project_photos
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);

ALTER TABLE project_picking
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);

ALTER TABLE project_templates
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);

ALTER TABLE quote_snapshots
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);

ALTER TABLE snapshot_prices
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);

ALTER TABLE production_activities
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);

ALTER TABLE damage_reports
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);

ALTER TABLE warranty_tickets
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_warranty_tickets_organization ON warranty_tickets(organization_id);

ALTER TABLE warranty_ticket_photos
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);

ALTER TABLE material_stock
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_material_stock_organization ON material_stock(organization_id);

ALTER TABLE stock_movements
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_organization ON stock_movements(organization_id);

ALTER TABLE suppliers
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);

ALTER TABLE purchase_orders
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_organization ON purchase_orders(organization_id);

ALTER TABLE purchase_order_items
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);

-- Per-organization numbering instead of global (ADR-0004: cloned catalogs and
-- per-org sequences must not collide across talleres).
ALTER TABLE warranty_tickets DROP CONSTRAINT IF EXISTS warranty_tickets_ticket_number_key;
ALTER TABLE warranty_tickets
    ADD CONSTRAINT warranty_tickets_org_ticket_number_unique
    UNIQUE (organization_id, ticket_number);

ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_number_key;
ALTER TABLE purchase_orders
    ADD CONSTRAINT purchase_orders_org_number_unique
    UNIQUE (organization_id, number);
