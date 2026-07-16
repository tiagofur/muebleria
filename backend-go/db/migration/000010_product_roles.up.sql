-- F035: product roles + legacy rename
-- disenador → ingeniero, carpintero → produccion; add gerente_ventas

UPDATE users SET role = 'ingeniero' WHERE role = 'disenador';
UPDATE users SET role = 'produccion' WHERE role = 'carpintero';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN (
        'admin',
        'user',
        'vendedor',
        'gerente_ventas',
        'ingeniero',
        'produccion'
    ));
