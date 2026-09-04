-- #395 / DT-11 down: restore the #387 absolute immutability trigger, drop the
-- approval policy/metadata and the UPDATE grant. Approvals recorded by #395
-- are lost (the revisions fall back to their published status); the snapshot
-- columns are untouched.

DROP POLICY IF EXISTS design_revisions_approve ON design_revisions;

CREATE OR REPLACE FUNCTION protect_design_revision_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'design_revisions is immutable once published';
END;
$$;

ALTER TABLE design_revisions
    DROP COLUMN IF EXISTS approved_by,
    DROP COLUMN IF EXISTS approved_at;

REVOKE UPDATE ON design_revisions FROM granete_app;
GRANT SELECT, INSERT ON design_revisions TO granete_app;

-- Restore the #387 inventory description (absolute immutability).
INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('design_revisions', 'explicitly-shared', 'project-organizations', 'owner-organization-immutable', 'Published design revisions are immutable snapshots following project organizations (#387 / I4 / I12)')
ON CONFLICT (table_name) DO UPDATE SET
 classification = EXCLUDED.classification,
 read_scope = EXCLUDED.read_scope,
 write_scope = EXCLUDED.write_scope,
 rationale = EXCLUDED.rationale,
 policy_version = rls_policy_inventory.policy_version + 1,
 updated_at = NOW();
