-- Rollback for ambient (floor/wall) materials (#4150). Never run at startup;
-- only by an explicit rollback tool. Safe (IF EXISTS).
DROP TABLE IF EXISTS ambient_materials;
