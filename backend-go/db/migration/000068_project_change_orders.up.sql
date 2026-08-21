-- OC-024 — Change orders for post-approval/post-release scope and cost modifications.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS change_orders JSONB;
