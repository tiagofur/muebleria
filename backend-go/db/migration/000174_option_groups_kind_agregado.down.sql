-- #1472: Revert option group kind check back to ('board', 'hardware', 'edge')
ALTER TABLE option_groups DROP CONSTRAINT IF EXISTS option_groups_kind_check;
ALTER TABLE option_groups ADD CONSTRAINT option_groups_kind_check
    CHECK (kind IN ('board', 'hardware', 'edge'));
