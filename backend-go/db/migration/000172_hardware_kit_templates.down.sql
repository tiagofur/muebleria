-- #1422 slice 2 reversal: drop the workshop kit templates table and its
-- tenant RLS surface. No other table references it (planning data only).
DROP POLICY IF EXISTS hardware_kit_templates_update ON hardware_kit_templates;
DROP POLICY IF EXISTS hardware_kit_templates_insert ON hardware_kit_templates;
DROP POLICY IF EXISTS hardware_kit_templates_read ON hardware_kit_templates;
DROP TABLE IF EXISTS hardware_kit_templates;

DELETE FROM rls_policy_inventory WHERE table_name = 'hardware_kit_templates';
