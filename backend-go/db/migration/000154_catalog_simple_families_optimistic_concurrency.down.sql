ALTER TABLE material_boards     DROP COLUMN IF EXISTS version;
ALTER TABLE edge_bands          DROP COLUMN IF EXISTS version;
ALTER TABLE option_groups       DROP COLUMN IF EXISTS version;
ALTER TABLE module_categories   DROP COLUMN IF EXISTS version;
ALTER TABLE customers           DROP COLUMN IF EXISTS version;
ALTER TABLE material_categories DROP COLUMN IF EXISTS version;
ALTER TABLE ambient_materials   DROP COLUMN IF EXISTS version;
ALTER TABLE ambient_categories  DROP COLUMN IF EXISTS version;
