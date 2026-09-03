DELETE FROM rls_policy_inventory
WHERE table_name = 'quote_line_furniture_instances';

DROP TABLE IF EXISTS quote_line_furniture_instances;

DROP FUNCTION IF EXISTS app_project_quote_mutable(UUID);

DROP INDEX IF EXISTS uq_furniture_instances_id_project;
DROP INDEX IF EXISTS uq_project_items_id_project;
