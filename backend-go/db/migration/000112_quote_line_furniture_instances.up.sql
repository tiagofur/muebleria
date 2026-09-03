-- #386 / DT-2: explicit QuoteLine ↔ FurnitureInstance relation (ADR-0003,
-- digital-thread §6). QuoteLine.quantity is COMMERCIAL GROUPING; each physical
-- unit keeps its own FurnitureInstance identity (I2). This table records which
-- physical units a quote line represents — it never owns furniture identity:
-- FurnitureInstance stays project-owned and quote only references it.
--
-- Current commercial representation: project_items is today's QuoteLine
-- (module + quantity per project) and projects.status is today's quote
-- acceptance ('accepted'/'produced' pin the commercial truth). When a
-- revisioned SalesQuote family lands it must add its own FK here and migrate
-- the anchor with explicit authority; the conceptual contract
-- (quoteRevisionId, quoteLineId, furnitureInstanceId) stays unchanged.
--
-- Classification: explicitly-shared, like project_items/furniture_instances.
-- Reads follow every organization explicitly named by the project; link
-- mutations require the OWNING organization and a commercially mutable
-- project (draft/quoted) — accepted/produced projects never change
-- materialization in place (I3 / §6 / anti-pattern 6).

-- Composite-FK anchors: make "same project" structurally enforceable for
-- both sides of the link. A quote line of project A can never reference a
-- furniture instance of project B, not even by direct SQL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_items_id_project
    ON project_items(id, project_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_furniture_instances_id_project
    ON furniture_instances(id, project_id);

CREATE TABLE quote_line_furniture_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Denormalized owning organization = projects.organization_id. The RLS
    -- insert check requires the match (and the caller's own org), and the
    -- ownership trigger below keeps it immutable.
    organization_id UUID NOT NULL REFERENCES organizations(id),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    quote_line_id UUID NOT NULL,
    furniture_instance_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- A quote line being edited keeps its id inside one transaction
    -- (replaceProjectItemsTx deletes and re-inserts the payload set), so this
    -- FK must be DEFERRABLE: the check runs at COMMIT and the re-inserted id
    -- satisfies it. Dropping a materialized line without unlinking first then
    -- fails loudly at COMMIT — the repository raises the typed conflict
    -- before this backstop fires.
    CONSTRAINT fk_quote_line_furniture_instances_line
        FOREIGN KEY (quote_line_id, project_id)
        REFERENCES project_items(id, project_id)
        DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT fk_quote_line_furniture_instances_instance
        FOREIGN KEY (furniture_instance_id, project_id)
        REFERENCES furniture_instances(id, project_id)
        ON DELETE CASCADE,
    -- One physical unit is represented by at most one quote line at a time;
    -- re-quoting an existing instance (#388) must unlink first.
    CONSTRAINT uq_quote_line_furniture_instances_instance
        UNIQUE (furniture_instance_id)
);

CREATE INDEX idx_quote_line_furniture_instances_organization
    ON quote_line_furniture_instances(organization_id);
CREATE INDEX idx_quote_line_furniture_instances_project
    ON quote_line_furniture_instances(project_id);
CREATE INDEX idx_quote_line_furniture_instances_quote_line
    ON quote_line_furniture_instances(quote_line_id);

-- Commercial immutability backstop (digital-thread §6 / I3): once the project
-- quote is accepted (or produced), link rows can neither be added nor removed
-- by the app role — later commercial changes require a new revision.
CREATE OR REPLACE FUNCTION app_project_quote_mutable(candidate_project_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM projects p
        WHERE p.id = candidate_project_id
          AND p.status IN ('draft', 'quoted')
    )
$$;

ALTER TABLE quote_line_furniture_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_line_furniture_instances FORCE ROW LEVEL SECURITY;

CREATE POLICY quote_line_furniture_read ON quote_line_furniture_instances
    FOR SELECT TO granete_app
    USING (app_can_access_project(project_id));

CREATE POLICY quote_line_furniture_insert ON quote_line_furniture_instances
    FOR INSERT TO granete_app
    WITH CHECK (
        app_can_access_project(project_id)
        AND app_shared_child_matches_project(project_id, organization_id)
        AND organization_id = app_current_organization_id()
        AND app_project_quote_mutable(project_id)
    );

CREATE POLICY quote_line_furniture_delete ON quote_line_furniture_instances
    FOR DELETE TO granete_app
    USING (
        app_can_access_project(project_id)
        AND organization_id = app_current_organization_id()
        AND app_project_quote_mutable(project_id)
    );

-- No UPDATE policy and no UPDATE grant: a link is an immutable fact (it
-- exists or it does not); reassigning a link means unlink + relink with
-- their own audited commands.

CREATE TRIGGER protect_shared_child_ownership
    BEFORE UPDATE OF organization_id, project_id ON quote_line_furniture_instances
    FOR EACH ROW
    EXECUTE FUNCTION protect_shared_child_ownership('project_id');

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('quote_line_furniture_instances', 'explicitly-shared', 'project-organizations', 'owner-organization-while-draft-or-quoted', 'Quote line ↔ furniture instance links follow the explicit project organizations; add/remove stays with the owning organization and only while the commercial state is mutable (draft/quoted). Accepted/produced quotes never change materialization in place (#386 / digital-thread §6)')
ON CONFLICT (table_name) DO UPDATE SET
 classification = EXCLUDED.classification,
 read_scope = EXCLUDED.read_scope,
 write_scope = EXCLUDED.write_scope,
 rationale = EXCLUDED.rationale,
 policy_version = rls_policy_inventory.policy_version + 1,
 updated_at = NOW();

GRANT EXECUTE ON FUNCTION app_project_quote_mutable(UUID) TO granete_app;

GRANT SELECT, INSERT, DELETE ON quote_line_furniture_instances TO granete_app;
REVOKE UPDATE ON quote_line_furniture_instances FROM granete_app;
