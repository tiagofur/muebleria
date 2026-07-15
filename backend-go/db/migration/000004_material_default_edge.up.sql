-- Material → default edge band link by FK (never by display name).
ALTER TABLE material_boards
  ADD COLUMN IF NOT EXISTS default_edge_band_id UUID REFERENCES edge_bands(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_material_boards_default_edge
  ON material_boards(default_edge_band_id);
