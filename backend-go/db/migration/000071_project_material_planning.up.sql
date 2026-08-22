-- OC-050..OC-054 (#302): material planning per project (requirements from the
-- released BOM, reservations, evidence-backed release) as a JSONB column on
-- projects, same convention as installation (000070). Writes only through the
-- dedicated materials endpoints.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS material_planning JSONB;
