-- #1627 slice 2 (review): «Sin inserto» explícito por mueble se guarda como
-- el valor "none" en el mapa de elecciones, pero project_item_choices
-- tipaba choice_entity_id como UUID (project_level_choices ya es VARCHAR):
-- guardar la elección en la web o materializar un diseño con «Sin inserto»
-- al cotizar fallaba. Mismo tipo que project_level_choices; los UUID
-- existentes se conservan como texto (todas las lecturas ya castean ::text).
ALTER TABLE project_item_choices
    ALTER COLUMN choice_entity_id TYPE VARCHAR(100) USING choice_entity_id::text;
