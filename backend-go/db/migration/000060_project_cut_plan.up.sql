-- 2D Guillotine Cut Plan & Sheet Optimization (F115).
-- Stores the exact multi-sheet layout, saw kerf, trim margins, pieces placed,
-- sequential cutting instructions, remnants and warehouse exact sheets count.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS cut_plan JSONB;
