-- Revert #670 Increment B tables and columns.

DROP TABLE IF EXISTS design_revision_assembly_snapshots;
DROP TABLE IF EXISTS published_assembly_snapshots;

ALTER TABLE agregados DROP CONSTRAINT IF EXISTS fk_agregados_current_revision;
DROP INDEX IF EXISTS idx_agregados_current_revision;
ALTER TABLE agregados DROP COLUMN IF EXISTS current_revision_id;

DROP TABLE IF EXISTS agregado_revisions;
DROP INDEX IF EXISTS uq_agregados_organization_id;

DELETE FROM rls_policy_inventory WHERE table_name IN (
    'agregado_revisions',
    'published_assembly_snapshots',
    'design_revision_assembly_snapshots'
);

DROP FUNCTION IF EXISTS protect_agregado_assembly_immutability();
