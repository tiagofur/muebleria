-- #1651 reversal: drop the price history. Current catalog prices are untouched.
DROP TABLE IF EXISTS catalog_price_history;
DELETE FROM rls_policy_inventory WHERE table_name = 'catalog_price_history';
