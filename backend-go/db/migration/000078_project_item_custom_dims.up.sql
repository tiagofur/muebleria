-- F144 / #310: free per-item dimensions ("a medida" desde Proyectar).
-- JSONB nullable: NULL = commercial preset. Without this column the Go
-- backend's full-replace of project_items silently drops customDims on save.
ALTER TABLE project_items
    ADD COLUMN IF NOT EXISTS custom_dims JSONB;
