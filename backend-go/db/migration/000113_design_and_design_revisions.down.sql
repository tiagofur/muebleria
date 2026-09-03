-- #387 / DT-3: remove designs, design revisions and design revision items.

DELETE FROM rls_policy_inventory WHERE table_name IN ('design_revision_items', 'design_revisions', 'designs');

DROP TABLE IF EXISTS design_revision_items;
DROP TABLE IF EXISTS design_revisions;
DROP TABLE IF EXISTS designs;

DROP FUNCTION IF EXISTS protect_design_revision_item_immutability();
DROP FUNCTION IF EXISTS protect_design_revision_immutability();
