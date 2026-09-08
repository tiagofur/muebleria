-- #499 upgrade reconciliation: some installations applied the original
-- 000124 migration before its organization-first index was added. Applied
-- migrations do not rerun, so add a separately owned index that restores the
-- tenant-index invariant without depending on 000124's historical contents.

CREATE INDEX IF NOT EXISTS idx_design_pairing_grants_organization_created
    ON design_pairing_grants(organization_id, created_at DESC);
