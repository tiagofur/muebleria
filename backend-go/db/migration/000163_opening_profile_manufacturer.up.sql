-- #1329: the profile's MANUFACTURER (short text, informational). The code
-- stays the identity; this names who makes the physical profile (e.g. SCILM)
-- so two gola L of different makers are distinguishable in the picker.
-- Additive nullable column: nil = not declared yet.
ALTER TABLE opening_profiles
	ADD COLUMN manufacturer TEXT;
