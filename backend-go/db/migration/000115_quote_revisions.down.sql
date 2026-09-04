DROP TRIGGER IF EXISTS protect_quote_revision_items_immutable ON quote_revision_items;
DROP FUNCTION IF EXISTS protect_quote_revision_item_immutability();
DROP TRIGGER IF EXISTS protect_quote_revisions_immutable ON quote_revisions;
DROP FUNCTION IF EXISTS protect_quote_revision_immutability();
DROP TABLE IF EXISTS quote_revision_items CASCADE;
DROP TABLE IF EXISTS quote_revisions CASCADE;
DELETE FROM rls_policy_inventory WHERE table_name IN ('quote_revisions', 'quote_revision_items');
