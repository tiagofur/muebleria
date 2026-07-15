-- F026: admin approval flow + role 'user' as generic user role
-- Ampliar el CHECK de roles para incluir 'user' como alias moderno
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('admin', 'user', 'vendedor', 'disenador', 'carpintero'));
