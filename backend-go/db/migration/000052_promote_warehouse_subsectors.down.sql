-- Reverse: convert direct material sectors back to warehouse+sub_sector.

-- Step 1: Re-insert warehouse sub_sector rows.
INSERT INTO user_sectors (user_id, sector, sub_sector)
SELECT user_id, 'warehouse', sector
FROM user_sectors
WHERE sector IN ('herrajes', 'tableros', 'cintillas')
ON CONFLICT (user_id, sector, sub_sector) DO NOTHING;

-- Step 2: Remove the direct sector rows.
DELETE FROM user_sectors
WHERE sector IN ('herrajes', 'tableros', 'cintillas');
