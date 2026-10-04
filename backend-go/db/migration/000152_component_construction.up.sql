-- #1052 slice 1: the component editor's construction block (constructive role,
-- active joinery faces, joinery system override) becomes persisted entity data.
-- NULL = inherit everything. The station pattern (stationsCount/margins) keeps
-- living in the factory policy overlay (#875) — never here.
ALTER TABLE components ADD COLUMN IF NOT EXISTS construction jsonb;
