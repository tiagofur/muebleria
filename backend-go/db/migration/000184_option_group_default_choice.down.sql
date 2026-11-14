ALTER TABLE option_groups
    DROP CONSTRAINT IF EXISTS option_groups_default_choice_valid;
ALTER TABLE option_groups
    DROP COLUMN IF EXISTS default_choice;
