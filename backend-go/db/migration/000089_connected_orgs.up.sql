-- #326: factories manage their sales network. A connected store/dealer points
-- at its parent factory; the parent link is set at creation and is not part
-- of any generic update flow.
ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS parent_organization_id UUID REFERENCES organizations(id);

CREATE INDEX IF NOT EXISTS idx_organizations_parent ON organizations(parent_organization_id);
