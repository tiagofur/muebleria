ALTER TABLE machine_output_selections
    DROP CONSTRAINT IF EXISTS machine_output_selections_profile_digest_format;
ALTER TABLE machine_output_selections
    DROP COLUMN IF EXISTS output_profile_digest;
