ALTER TABLE purchase_orders
  DROP COLUMN IF EXISTS expected_at,
  DROP COLUMN IF EXISTS required_by;

ALTER TABLE purchase_order_items
  DROP COLUMN IF EXISTS allocated_project_id,
  DROP COLUMN IF EXISTS unit_cost;
