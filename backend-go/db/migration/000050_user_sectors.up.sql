-- User-sector assignments for production operators.
-- An operator can have multiple sectors; warehouse operators can have sub-sectors
-- (herrajes, tableros, cintillas) to separate material types.

CREATE TABLE IF NOT EXISTS user_sectors (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sector      TEXT NOT NULL,
    sub_sector  TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, sector, sub_sector)
);

CREATE INDEX IF NOT EXISTS idx_user_sectors_user ON user_sectors(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sectors_sector ON user_sectors(sector);

-- Migrate existing 'produccion' role users to have all sectors by default.
-- This ensures backward compatibility — existing production users can see everything.
INSERT INTO user_sectors (user_id, sector, sub_sector)
SELECT id, 'cutting', '' FROM users WHERE role = 'produccion'
ON CONFLICT (user_id, sector, sub_sector) DO NOTHING;

INSERT INTO user_sectors (user_id, sector, sub_sector)
SELECT id, 'edge_banding', '' FROM users WHERE role = 'produccion'
ON CONFLICT (user_id, sector, sub_sector) DO NOTHING;

INSERT INTO user_sectors (user_id, sector, sub_sector)
SELECT id, 'cnc', '' FROM users WHERE role = 'produccion'
ON CONFLICT (user_id, sector, sub_sector) DO NOTHING;

INSERT INTO user_sectors (user_id, sector, sub_sector)
SELECT id, 'assembly', '' FROM users WHERE role = 'produccion'
ON CONFLICT (user_id, sector, sub_sector) DO NOTHING;

INSERT INTO user_sectors (user_id, sector, sub_sector)
SELECT id, 'packaging', '' FROM users WHERE role = 'produccion'
ON CONFLICT (user_id, sector, sub_sector) DO NOTHING;

INSERT INTO user_sectors (user_id, sector, sub_sector)
SELECT id, 'shipping', '' FROM users WHERE role = 'produccion'
ON CONFLICT (user_id, sector, sub_sector) DO NOTHING;

INSERT INTO user_sectors (user_id, sector, sub_sector)
SELECT id, 'installation', '' FROM users WHERE role = 'produccion'
ON CONFLICT (user_id, sector, sub_sector) DO NOTHING;

INSERT INTO user_sectors (user_id, sector, sub_sector)
SELECT id, 'warehouse', '' FROM users WHERE role = 'produccion'
ON CONFLICT (user_id, sector, sub_sector) DO NOTHING;
