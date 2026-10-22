-- #1394: a module hardware line may belong to ONE catalog component. When the
-- link is set, the line is per-copy: the resolved BOM multiplies its quantity
-- by the effective copies of that component after bindings (the same N of
-- #1383/#1384). NULL keeps the line fixed (module bulk hardware) — additive,
-- existing catalogs change no behavior.
-- Same FK shape as module_components.component_id (#102): the components PK is
-- global; same-organization integrity is enforced by the write paths, and a
-- deleted component de-links the line (SET NULL) instead of blocking the
-- catalog delete.
ALTER TABLE hardware_lines
    ADD COLUMN IF NOT EXISTS component_id UUID REFERENCES components(id) ON DELETE SET NULL;
