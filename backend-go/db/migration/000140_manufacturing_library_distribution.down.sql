-- 000140_manufacturing_library_distribution.down.sql
-- Reverses migration 000140.

DELETE FROM rls_policy_inventory WHERE table_name = 'library_resource_blobs';
DROP TRIGGER IF EXISTS protect_library_resource_blobs_immutable ON library_resource_blobs;
DROP FUNCTION IF EXISTS protect_library_resource_blobs_immutability();
DROP TABLE IF EXISTS library_resource_blobs CASCADE;

DELETE FROM rls_policy_inventory WHERE table_name = 'library_release_manifests';
DROP TRIGGER IF EXISTS protect_library_release_manifests_immutable ON library_release_manifests;
DROP FUNCTION IF EXISTS protect_library_release_manifests_immutability();
DROP TABLE IF EXISTS library_release_manifests CASCADE;

REVOKE UPDATE (definition_hash) ON library_release_resource_refs FROM granete_app;
