-- 000143_hardware_profiles.down.sql
DELETE FROM rls_policy_inventory WHERE table_name = 'hardware_profiles';
DROP TABLE IF EXISTS hardware_profiles CASCADE;
