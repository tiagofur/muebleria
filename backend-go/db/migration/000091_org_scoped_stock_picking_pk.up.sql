-- F182 / #421: material_stock and project_picking kept GLOBAL primary keys
-- ((kind, material_id) / (project_id, material)) after the multi-org scoping,
-- so their ON CONFLICT upserts (UpsertStockMin, UpsertProjectPicking) could
-- resolve the conflict against ANOTHER organization's row and update it from
-- a foreign org context. Both keys become organization-scoped, matching every
-- other business unique (material_boards_org_code_unique et al).

ALTER TABLE material_stock DROP CONSTRAINT material_stock_pkey;
ALTER TABLE material_stock
    ADD CONSTRAINT material_stock_pkey PRIMARY KEY (kind, material_id, organization_id);

ALTER TABLE project_picking DROP CONSTRAINT project_picking_pkey;
ALTER TABLE project_picking
    ADD CONSTRAINT project_picking_pkey PRIMARY KEY (project_id, material, organization_id);
