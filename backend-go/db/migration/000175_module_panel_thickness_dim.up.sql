-- #1496: tipo de mueble «panel» — cuál dimensión externa es el espesor del
-- panel (derivada del material de frentes al resolver). furniture_type es
-- TEXT libre (000028): el valor 'panel' no requiere migración.
ALTER TABLE modules ADD COLUMN IF NOT EXISTS panel_thickness_dim TEXT NOT NULL DEFAULT '';
