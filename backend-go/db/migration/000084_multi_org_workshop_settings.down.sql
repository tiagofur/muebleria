ALTER TABLE workshop_settings
    ALTER COLUMN id SET DEFAULT 1;
DROP SEQUENCE IF EXISTS workshop_settings_id_seq;
ALTER TABLE workshop_settings
    ADD CONSTRAINT workshop_settings_id_check CHECK (id = 1);

ALTER TABLE workshop_settings DROP CONSTRAINT IF EXISTS workshop_settings_organization_unique;
ALTER TABLE workshop_settings DROP COLUMN IF EXISTS organization_id;
