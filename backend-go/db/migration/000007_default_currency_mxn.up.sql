-- Product default currency is MXN (Mexico). Restores DEFAULT after the
-- mistaken UYU migration and realigns rows that were flipped to UYU.
ALTER TABLE projects ALTER COLUMN currency SET DEFAULT 'MXN';

UPDATE projects SET currency = 'MXN' WHERE currency = 'UYU';
