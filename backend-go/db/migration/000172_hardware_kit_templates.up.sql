-- #1422 slice 2: plantillas de juego editables por taller. Declarative
-- "juego de herraje" blueprints (slots JSONB validated in app, motion from a
-- closed vocabulary) the hardware-kit wizard arms. Client-minted identity
-- (#1398 convention); optimistic concurrency via version (If-Match, #443).
-- Tenant-owned like the rest of the catalog (000094/000131 discipline):
-- organization-scoped rows, RLS policies for granete_app, DELETE revoked —
-- removal is the soft deactivate (active=false), never a physical delete.
CREATE TABLE IF NOT EXISTS hardware_kit_templates (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id),
    code TEXT NOT NULL,
    label_es TEXT NOT NULL,
    agregado_label_es TEXT NOT NULL,
    motion TEXT NOT NULL,
    slots JSONB NOT NULL DEFAULT '[]'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_hardware_kit_templates_organization ON hardware_kit_templates(organization_id);

ALTER TABLE hardware_kit_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE hardware_kit_templates FORCE ROW LEVEL SECURITY;

CREATE POLICY hardware_kit_templates_read ON hardware_kit_templates
    FOR SELECT TO granete_app
    USING (organization_id = app_current_organization_id());

CREATE POLICY hardware_kit_templates_insert ON hardware_kit_templates
    FOR INSERT TO granete_app
    WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY hardware_kit_templates_update ON hardware_kit_templates
    FOR UPDATE TO granete_app
    USING (organization_id = app_current_organization_id())
    WITH CHECK (organization_id = app_current_organization_id());

INSERT INTO rls_policy_inventory
    (table_name, classification, read_scope, write_scope, rationale)
VALUES
    ('hardware_kit_templates', 'tenant-owned', 'organization', 'organization', 'Workshop kit templates feeding the hardware-kit wizard (#1422 slice 2): org-scoped planning data, no cross-tenant sharing, soft-deactivate only')
ON CONFLICT (table_name) DO UPDATE SET
    classification = EXCLUDED.classification,
    read_scope = EXCLUDED.read_scope,
    write_scope = EXCLUDED.write_scope,
    rationale = EXCLUDED.rationale,
    policy_version = rls_policy_inventory.policy_version + 1,
    updated_at = NOW();

GRANT SELECT, INSERT, UPDATE ON hardware_kit_templates TO granete_app;
REVOKE DELETE ON hardware_kit_templates FROM granete_app;
