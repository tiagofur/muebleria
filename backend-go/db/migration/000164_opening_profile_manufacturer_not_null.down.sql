-- #1345 down: relax back to the pre-000164 shape (000163's nullable column);
-- existing '' values stay as the truthful absence.
ALTER TABLE opening_profiles
	ALTER COLUMN manufacturer DROP NOT NULL,
	ALTER COLUMN manufacturer DROP DEFAULT;
