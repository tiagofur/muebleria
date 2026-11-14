-- #1627 slice 2: qué monta un cajón cuando el mueble no elige inserto.
-- 'first_active' = la primera opción activa en el orden guardado (#1620,
-- comportamiento de hoy para todas las filas existentes); 'none' = sin
-- inserto. Sólo tiene efecto en grupos vinculados a un kit (kit_hardware_id).
ALTER TABLE option_groups
    ADD COLUMN IF NOT EXISTS default_choice TEXT NOT NULL DEFAULT 'first_active';

ALTER TABLE option_groups
    DROP CONSTRAINT IF EXISTS option_groups_default_choice_valid;
ALTER TABLE option_groups
    ADD CONSTRAINT option_groups_default_choice_valid CHECK (default_choice IN ('first_active', 'none'));
