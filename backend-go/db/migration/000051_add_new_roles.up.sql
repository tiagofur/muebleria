-- Add new roles: gerente_produccion, almacen
-- Remove operador (was redundant with produccion)

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN (
        'admin',
        'user',
        'vendedor',
        'gerente_ventas',
        'gerente_produccion',
        'ingeniero',
        'produccion',
        'almacen'
    ));
