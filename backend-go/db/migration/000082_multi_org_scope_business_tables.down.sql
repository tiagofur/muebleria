ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_org_number_unique;
ALTER TABLE purchase_orders
    ADD CONSTRAINT purchase_orders_number_key UNIQUE (number);

ALTER TABLE warranty_tickets DROP CONSTRAINT IF EXISTS warranty_tickets_org_ticket_number_unique;
ALTER TABLE warranty_tickets
    ADD CONSTRAINT warranty_tickets_ticket_number_key UNIQUE (ticket_number);

ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS organization_id;

DROP INDEX IF EXISTS idx_purchase_orders_organization;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS organization_id;

ALTER TABLE suppliers DROP COLUMN IF EXISTS organization_id;

DROP INDEX IF EXISTS idx_stock_movements_organization;
ALTER TABLE stock_movements DROP COLUMN IF EXISTS organization_id;

DROP INDEX IF EXISTS idx_material_stock_organization;
ALTER TABLE material_stock DROP COLUMN IF EXISTS organization_id;

ALTER TABLE warranty_ticket_photos DROP COLUMN IF EXISTS organization_id;

DROP INDEX IF EXISTS idx_warranty_tickets_organization;
ALTER TABLE warranty_tickets DROP COLUMN IF EXISTS organization_id;

ALTER TABLE damage_reports DROP COLUMN IF EXISTS organization_id;

ALTER TABLE production_activities DROP COLUMN IF EXISTS organization_id;

ALTER TABLE snapshot_prices DROP COLUMN IF EXISTS organization_id;

ALTER TABLE quote_snapshots DROP COLUMN IF EXISTS organization_id;

ALTER TABLE project_templates DROP COLUMN IF EXISTS organization_id;

ALTER TABLE project_picking DROP COLUMN IF EXISTS organization_id;

ALTER TABLE project_photos DROP COLUMN IF EXISTS organization_id;

ALTER TABLE project_internal_messages DROP COLUMN IF EXISTS organization_id;

DROP INDEX IF EXISTS idx_project_events_organization;
ALTER TABLE project_events DROP COLUMN IF EXISTS organization_id;

ALTER TABLE project_item_floor_events DROP COLUMN IF EXISTS organization_id;

ALTER TABLE project_level_choices DROP COLUMN IF EXISTS organization_id;

ALTER TABLE project_item_choices DROP COLUMN IF EXISTS organization_id;

DROP INDEX IF EXISTS idx_project_items_organization;
ALTER TABLE project_items DROP COLUMN IF EXISTS organization_id;

DROP INDEX IF EXISTS idx_projects_organization;
ALTER TABLE projects DROP COLUMN IF EXISTS organization_id;

DROP INDEX IF EXISTS idx_customers_organization;
ALTER TABLE customers DROP COLUMN IF EXISTS organization_id;
