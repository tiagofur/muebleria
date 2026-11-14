ALTER TABLE option_group_members
    DROP CONSTRAINT IF EXISTS option_group_members_position_non_negative;
ALTER TABLE option_group_members
    DROP COLUMN IF EXISTS position;
