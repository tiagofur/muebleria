ALTER TABLE modules DROP CONSTRAINT IF EXISTS modules_version_positive;
ALTER TABLE modules DROP COLUMN IF EXISTS version;
