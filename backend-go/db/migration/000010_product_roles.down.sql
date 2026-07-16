-- Reverse F035 product roles (best-effort; may fail if gerente_ventas rows exist)

UPDATE users SET role = 'disenador' WHERE role = 'ingeniero';
UPDATE users SET role = 'carpintero' WHERE role = 'produccion';
UPDATE users SET role = 'user' WHERE role = 'gerente_ventas';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('admin', 'user', 'vendedor', 'disenador', 'carpintero'));
