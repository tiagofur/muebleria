-- Product default currency is UYU (Uruguay), not the plantilla MXN legacy default.
ALTER TABLE projects ALTER COLUMN currency SET DEFAULT 'UYU';

-- Align existing rows that still carry the schema bootstrap default.
UPDATE projects SET currency = 'UYU' WHERE currency = 'MXN';
