ALTER TABLE organizations ADD COLUMN active BOOLEAN;
UPDATE organizations SET active = status = 'active';
ALTER TABLE organizations ALTER COLUMN active SET NOT NULL;
ALTER TABLE organizations ALTER COLUMN active SET DEFAULT FALSE;
