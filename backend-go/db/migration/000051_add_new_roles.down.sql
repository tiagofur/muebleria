-- Revert to original roles (remove gerente_produccion, almacen)

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
