-- Project-level option defaults (F029 / issue #35)
CREATE TABLE IF NOT EXISTS project_level_choices (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    option_group_code VARCHAR(50) NOT NULL,
    choice_entity_id VARCHAR(100) NOT NULL,
    PRIMARY KEY (project_id, option_group_code)
);

CREATE INDEX IF NOT EXISTS idx_project_level_choices_project
    ON project_level_choices (project_id);
