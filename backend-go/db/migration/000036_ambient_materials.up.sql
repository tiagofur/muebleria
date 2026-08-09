-- #4150: ambient (floor/wall) materials for the 3D scene. Presentation-only —
-- NO pricing/BOM fields, so ambient materials can never leak into quotes,
-- cutlists, cost breakdowns or the Optimizer export. Mirrors the preview_*
-- subset of material_boards (color, texture, tile mm, PBR roughness/metalness/
-- clearcoat) plus a surface_type discriminator.
--
-- Global catalog entity (single-tenant), like material_boards/edge_bands/
-- hardwares: there is no workspaces table in the backend (workspace is a FE
-- JSON concept), so no workspace_id / FK. The FE mints the id (UUID) and sends
-- it on POST, exactly as it does for every other catalog entity.
--
-- All preview_* columns are nullable so NULL (unset) stays distinct from 0 in
-- the client optionalNum contract (previewRoughness===0 is a real value).
-- Additive + re-run safe (IF NOT EXISTS); applies automatically on server start.
CREATE TABLE IF NOT EXISTS ambient_materials (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    surface_type TEXT NOT NULL,
    preview_color TEXT,
    preview_texture_url TEXT,
    preview_texture_tile_width_mm DOUBLE PRECISION,
    preview_texture_tile_length_mm DOUBLE PRECISION,
    preview_roughness DOUBLE PRECISION,
    preview_metalness DOUBLE PRECISION,
    preview_clearcoat DOUBLE PRECISION
);
