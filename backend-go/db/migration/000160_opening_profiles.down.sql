-- El down de 000094 recorre rls_policy_inventory y ALTERa cada tabla listada:
-- la fila del inventario muere ANTES de dropear la tabla, o el rollback de
-- migraciones posteriores tropieza con una tabla que ya no existe.
DELETE FROM rls_policy_inventory WHERE table_name = 'opening_profiles';
DROP TABLE IF EXISTS opening_profiles;
