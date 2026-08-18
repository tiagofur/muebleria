ALTER TABLE production_activities
  ALTER COLUMN item_id SET NOT NULL;

ALTER TABLE edge_bands
  DROP COLUMN IF EXISTS preview_color;
