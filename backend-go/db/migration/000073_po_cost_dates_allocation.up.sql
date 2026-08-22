-- OC-052/OC-053 (#302): purchase orders born from real shortage carry an
-- allocation to the obra, a unit cost snapshot (job costing) and need-by /
-- expected dates.
ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC,
  ADD COLUMN IF NOT EXISTS allocated_project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS required_by DATE,
  ADD COLUMN IF NOT EXISTS expected_at DATE;
