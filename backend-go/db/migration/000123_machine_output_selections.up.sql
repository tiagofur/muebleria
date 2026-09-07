-- #591 [WEB-MFG-2]: exact machine output selection per organization+operation.
-- One manufacturing operation -> one exact MachineProfile revision, one exact
-- OutputCompatibilityProfile revision, one exact PostprocessorAdapter
-- version/digest. Normal production resolves this tuple only; validation
-- packs are separate by design. Tenant-owned.

CREATE TABLE machine_output_selections (
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    operation TEXT NOT NULL CHECK (operation IN ('cutting', 'machining')),
    machine_profile_id TEXT NOT NULL,
    machine_profile_revision_id TEXT NOT NULL,
    output_profile_id TEXT NOT NULL,
    output_profile_revision_id TEXT NOT NULL,
    adapter_id TEXT NOT NULL,
    adapter_version TEXT NOT NULL,
    adapter_implementation_digest TEXT NOT NULL,
    version BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (organization_id, operation)
);

ALTER TABLE machine_output_selections ENABLE ROW LEVEL SECURITY;

CREATE POLICY machine_output_selections_read ON machine_output_selections
    FOR SELECT TO granete_app
    USING (organization_id = app_current_organization_id());

CREATE POLICY machine_output_selections_write ON machine_output_selections
    FOR ALL TO granete_app
    USING (organization_id = app_current_organization_id())
    WITH CHECK (organization_id = app_current_organization_id());

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES ('machine_output_selections', 'tenant-owned', 'owner-organization',
    'owner-organization-versioned', 'Exact machine/profile/adapter tuple selected by the factory for normal manufacturing generation (#591); never cross-org');

GRANT SELECT, INSERT, UPDATE ON machine_output_selections TO granete_app;
