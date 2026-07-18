-- #108 Slice 2: structure revision versioning (parity with packages/domain).
-- Each edit of a published structure snapshots the previous BOM-relevant fields
-- into an immutable structure_revisions row, so closed quotes can be re-resolved
-- against the exact revision they used.

ALTER TABLE structures
    ADD COLUMN IF NOT EXISTS revision INT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS structure_revisions (
    structure_id UUID NOT NULL REFERENCES structures(id) ON DELETE CASCADE,
    revision     INT   NOT NULL,
    snapshot     JSONB NOT NULL,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (structure_id, revision)
);

-- #108: per-line-item pin freezing the structure revision used at close time.
-- Nullable (NULL = live / current revision).
ALTER TABLE project_items
    ADD COLUMN IF NOT EXISTS structure_revision_pin INT;
