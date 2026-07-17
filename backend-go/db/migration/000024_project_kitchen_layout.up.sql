-- Kitchen plan (walls + placements) for quote visualization (#133).
-- JSONB: { walls: [...], placements: [...] }. Null = no plan (linear 3D fallback).

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS kitchen_layout JSONB;
