ALTER TABLE design_revision_items DROP COLUMN IF EXISTS option_finishes;
ALTER TABLE design_working_items DROP COLUMN IF EXISTS option_finishes;
ALTER TABLE project_item_choices DROP COLUMN IF EXISTS finish_id;
