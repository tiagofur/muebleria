-- #1283 / §13.2 (contrato #1282): the 8006 datasheet geometry is decimal
-- (56.5 mm tall × 27.2 mm deep, SCILM "GOLA" PROFILES 2022-04-01 p. 42).
-- INTEGER columns cannot hold the datasheet value, and rounding the source
-- of truth is the silent invention the contract forbids.
ALTER TABLE opening_profiles
	ALTER COLUMN profile_height_mm TYPE REAL,
	ALTER COLUMN profile_depth_mm TYPE REAL;
