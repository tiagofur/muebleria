-- #327 hardening: drop the TRANSITIONAL organization_id DEFAULTs from
-- 000082/000083/000084. Every write path now passes the organization
-- explicitly (org-scoped auth context) and the middleware rejects
-- org-less tokens on business routes — an unscoped INSERT must fail
-- loudly instead of silently landing in the initial organization.

ALTER TABLE agregados ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE ambient_categories ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE ambient_materials ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE board_parts ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE components ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE customers ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE damage_reports ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE edge_bands ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE hardware_lines ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE hardwares ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE material_boards ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE material_categories ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE material_stock ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE module_categories ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE module_components ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE module_presets ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE modules ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE option_group_members ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE option_groups ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE production_activities ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE project_events ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE project_internal_messages ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE project_item_choices ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE project_item_floor_events ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE project_items ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE project_level_choices ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE project_photos ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE project_picking ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE project_templates ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE projects ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE purchase_order_items ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE purchase_orders ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE quote_snapshots ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE snapshot_prices ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE stock_movements ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE structure_components ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE structure_presets ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE structure_revisions ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE structures ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE suppliers ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE warranty_ticket_photos ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE warranty_tickets ALTER COLUMN organization_id DROP DEFAULT;
ALTER TABLE workshop_settings ALTER COLUMN organization_id DROP DEFAULT;
