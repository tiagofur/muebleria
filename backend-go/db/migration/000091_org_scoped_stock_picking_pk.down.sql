-- Reverts 000091. Fails when cross-org duplicate rows were created under the
-- org-scoped keys (acceptable: down targets a rollback before that exists).

ALTER TABLE project_picking DROP CONSTRAINT project_picking_pkey;
ALTER TABLE project_picking
    ADD CONSTRAINT project_picking_pkey PRIMARY KEY (project_id, material);

ALTER TABLE material_stock DROP CONSTRAINT material_stock_pkey;
ALTER TABLE material_stock
    ADD CONSTRAINT material_stock_pkey PRIMARY KEY (kind, material_id);
