-- 000145_hardware_profiles_recipe.up.sql
-- #916 added the embedded recipe body to the domain contract and the
-- release payload, but the table never gained its column — profiles with
-- recipes could not persist (found by the #955 demo seed integration test;
-- the golden scenario used in-memory stubs so the gap stayed invisible).

ALTER TABLE hardware_profiles ADD COLUMN IF NOT EXISTS recipe JSONB NULL;
