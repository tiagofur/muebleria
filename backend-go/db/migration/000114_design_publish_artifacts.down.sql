-- #392 / DT-8 down migration: drop staged publish sessions and design
-- revision artifact metadata. Artifact BYTES under the media namespace are
-- not managed by SQL and must be cleaned by the operator (admin clean-media
-- family) — the down migration only restores the relational shape.

DROP TRIGGER IF EXISTS protect_design_revision_artifacts_immutable ON design_revision_artifacts;
DROP FUNCTION IF EXISTS protect_design_revision_artifact_immutability();
DROP TABLE IF EXISTS design_revision_artifacts;
DELETE FROM rls_policy_inventory WHERE table_name = 'design_revision_artifacts';

DROP TABLE IF EXISTS design_publish_artifacts;
DELETE FROM rls_policy_inventory WHERE table_name = 'design_publish_artifacts';

DROP TRIGGER IF EXISTS protect_shared_child_ownership_publish_sessions ON design_publish_sessions;
DROP TABLE IF EXISTS design_publish_sessions;
DELETE FROM rls_policy_inventory WHERE table_name = 'design_publish_sessions';
