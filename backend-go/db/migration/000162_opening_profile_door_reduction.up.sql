-- #1316: the workshop-facing DOOR DISCOUNT lives per profile as one number
-- (the owner chose 30–40 mm for the metal gola; the datasheet pair
-- front_reduction_mm + grip_clearance_mm remains as documentation). Additive
-- nullable column: nil = the profile resolves the legacy pair sum, and every
-- pin authored before this column keeps its frozen arithmetic untouched.
ALTER TABLE opening_profiles
	ADD COLUMN door_reduction_mm INTEGER;
