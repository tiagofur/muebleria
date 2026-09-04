DROP TABLE IF EXISTS quote_revision_items CASCADE;
DROP TABLE IF EXISTS quote_revisions CASCADE;
DELETE FROM rls_policy_inventory WHERE table_name IN ('quote_revisions', 'quote_revision_items');
