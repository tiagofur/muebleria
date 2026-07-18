-- #109 / H14: project-level measure defaults keyed by furniture type, and the
-- furniture type tag on modules. Both additive; legacy rows get NULL/''
-- (defaults to 'inferior' on read).

-- Fundamental furniture type on modules: "inferior" | "superior" | "alto".
-- Empty string = 'inferior' (legacy default).
ALTER TABLE modules
    ADD COLUMN IF NOT EXISTS furniture_type TEXT NOT NULL DEFAULT '';

-- Project-level measure defaults. Shape (JSONB):
--   { "inferior"|"superior"|"alto": { "depth": 560, "height": 720 } }
-- NULL = no project defaults (every module uses its first preset).
ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS measure_defaults JSONB;
