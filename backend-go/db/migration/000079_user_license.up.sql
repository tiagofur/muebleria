ALTER TABLE users
    ADD COLUMN license_plan TEXT NOT NULL DEFAULT 'none'
        CHECK (license_plan IN ('none', 'trial', 'pro')),
    ADD COLUMN license_expires_at TIMESTAMPTZ NULL;
