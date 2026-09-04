-- #395 / DT-11 down: drop the ProductionRelease table. Released history is
-- destroyed with it (the design/quote revisions it pinned remain). The
-- inventory row must go with the table so the foundation down-chain
-- (000094) never references a dropped relation.

DROP TABLE IF EXISTS production_releases;
DELETE FROM rls_policy_inventory WHERE table_name = 'production_releases';
