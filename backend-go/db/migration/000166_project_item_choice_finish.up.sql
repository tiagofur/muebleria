-- #1209 PR2: the chosen commercial finish rides the option choice row on
-- project lines and the design working/revision items.
-- NULL/{} = no finish choice (legacy rows and non-finished choices).
ALTER TABLE project_item_choices ADD COLUMN IF NOT EXISTS finish_id TEXT;
ALTER TABLE design_working_items ADD COLUMN IF NOT EXISTS option_finishes JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE design_revision_items ADD COLUMN IF NOT EXISTS option_finishes JSONB NOT NULL DEFAULT '{}'::jsonb;
