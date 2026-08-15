-- Migration: 000044_project_technical_workflow.up.sql
-- Description: Add technical workflow fields to projects and create project_internal_messages table.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS assigned_engineer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS technical_status VARCHAR(50) NOT NULL DEFAULT 'pending_assignment',
  ADD COLUMN IF NOT EXISTS survey_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS installation_scheduled_date DATE;

CREATE INDEX IF NOT EXISTS idx_projects_assigned_engineer_id ON projects(assigned_engineer_id);
CREATE INDEX IF NOT EXISTS idx_projects_technical_status ON projects(technical_status);

CREATE TABLE IF NOT EXISTS project_internal_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sender_name VARCHAR(255) NOT NULL DEFAULT '',
  message_type VARCHAR(50) NOT NULL DEFAULT 'comment'
    CHECK (message_type IN ('comment', 'technical_query', 'query_response', 'design_change', 'production_alert', 'gate_approval')),
  content TEXT NOT NULL,
  is_resolved BOOLEAN NOT NULL DEFAULT true,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_project_internal_messages_project_id_created_at
  ON project_internal_messages(project_id, created_at ASC);
