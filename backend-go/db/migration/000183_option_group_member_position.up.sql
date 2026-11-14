-- #1627 slice 1: orden declarado de las opciones de un grupo. El inserto de
-- cajón por defecto es la PRIMERA opción activa (#1620) y hasta ahora los
-- miembros se leían por entity_id (UUID), sin orden elegible.
--
-- Aditiva y sin backfill: todas las filas existentes quedan en 0 y la lectura
-- ordena por (position, entity_id), exactamente el orden de hoy. Desde la
-- próxima escritura del grupo, position = índice en el orden recibido.
ALTER TABLE option_group_members
    ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

ALTER TABLE option_group_members
    DROP CONSTRAINT IF EXISTS option_group_members_position_non_negative;
ALTER TABLE option_group_members
    ADD CONSTRAINT option_group_members_position_non_negative CHECK (position >= 0);
