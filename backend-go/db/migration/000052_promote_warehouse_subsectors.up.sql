-- Promote warehouse sub-sectors to first-class sectors (F094 refined).
-- warehouse + sub_sector 'herrajes'/'tableros'/'cintillas' → direct sector names.
-- This makes the 3 material types standalone sectors, no nesting.

-- Step 1: Insert direct sector rows for existing warehouse sub_sector assignments.
INSERT INTO user_sectors (user_id, sector, sub_sector)
SELECT user_id, sub_sector, ''
FROM user_sectors
WHERE sector = 'warehouse' AND sub_sector IN ('herrajes', 'tableros', 'cintillas')
ON CONFLICT (user_id, sector, sub_sector) DO NOTHING;

-- Step 2: Remove the old warehouse+sub_sector rows that were migrated.
DELETE FROM user_sectors
WHERE sector = 'warehouse' AND sub_sector IN ('herrajes', 'tableros', 'cintillas');

-- Step 3: Clean up any remaining warehouse rows with empty sub_sector
-- (they had no specific material type — remove them since warehouse is
-- no longer an assignable sector for almacen).
DELETE FROM user_sectors
WHERE sector = 'warehouse' AND sub_sector = '';
