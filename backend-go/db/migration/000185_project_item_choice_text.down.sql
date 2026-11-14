-- Vuelve a UUID. Las elecciones que no son UUID (el «Sin inserto» "none"
-- de #1627) no caben en el tipo y se eliminan: el mueble vuelve a heredar
-- el default del selector.
DELETE FROM project_item_choices
WHERE choice_entity_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
ALTER TABLE project_item_choices
    ALTER COLUMN choice_entity_id TYPE UUID USING choice_entity_id::uuid;
