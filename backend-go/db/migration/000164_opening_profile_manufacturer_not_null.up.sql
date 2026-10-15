-- #1345: 000163 added manufacturer as a NULLABLE TEXT column, but the domain
-- field is a plain string — every row authored before the migration holds
-- NULL and pgx refuses to scan NULL into it (the picker's 500 on any dev DB
-- with pre-existing profiles). Align the column with the domain's absence
-- semantics ('' = not declared): backfill, then forbid NULL for good so a
-- direct-SQL insert can never reintroduce the broken state.
UPDATE opening_profiles SET manufacturer = '' WHERE manufacturer IS NULL;
ALTER TABLE opening_profiles
	ALTER COLUMN manufacturer SET DEFAULT '',
	ALTER COLUMN manufacturer SET NOT NULL;
