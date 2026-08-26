-- ADR-0004 / #325: workshop settings become one row per organization.
-- The legacy singleton row (id=1) keeps working for the initial org; new
-- organizations get their own row. The smallint id survives for now (existing
-- queries read id=1) and is dropped later once reads are org-scoped (F170).

ALTER TABLE workshop_settings
    ADD COLUMN IF NOT EXISTS organization_id UUID NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES organizations(id);
ALTER TABLE workshop_settings
    ADD CONSTRAINT workshop_settings_organization_unique UNIQUE (organization_id);

-- Allow one row per organization: drop the id=1 singleton check and let new
-- rows take ids from a sequence starting after the existing row.
ALTER TABLE workshop_settings DROP CONSTRAINT IF EXISTS workshop_settings_id_check;
CREATE SEQUENCE IF NOT EXISTS workshop_settings_id_seq START WITH 2
    OWNED BY workshop_settings.id;
ALTER TABLE workshop_settings
    ALTER COLUMN id SET DEFAULT nextval('workshop_settings_id_seq');
