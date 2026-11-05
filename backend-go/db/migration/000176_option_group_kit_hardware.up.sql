-- #1502: kit accesorio elegible. When set, this option group offers
-- ACCESSORY options for the referenced kit (the commercial set): the user
-- picks the accessory variant (galería / boxcover / boxcap…) and the engine
-- materializes + quotes it per bay on top of the kit. Nullable = legacy
-- group (byte-identical behavior). Symmetric of hardwares.kit_hardware_id
-- (parts → kit, required; group → eligible accessory). Existence/active/
-- kind-hardware validated server-side (fail-closed 422), not via FK.
ALTER TABLE option_groups ADD COLUMN IF NOT EXISTS kit_hardware_id UUID;
