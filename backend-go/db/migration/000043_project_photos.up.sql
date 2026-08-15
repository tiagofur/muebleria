-- 000043_project_photos: Project gallery photos by stage (survey, in_workshop, installed, delivery_receipt)

CREATE TABLE IF NOT EXISTS project_photos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    stage VARCHAR(50) NOT NULL CHECK (stage IN ('survey', 'in_workshop', 'installed', 'delivery_receipt')),
    url VARCHAR(500) NOT NULL,
    thumbnail_url VARCHAR(500),
    caption TEXT,
    is_showcase BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_project_photos_project_id ON project_photos(project_id);
CREATE INDEX IF NOT EXISTS idx_project_photos_stage ON project_photos(stage);
CREATE INDEX IF NOT EXISTS idx_project_photos_showcase ON project_photos(is_showcase) WHERE is_showcase = true;
