DELETE FROM rls_policy_inventory WHERE table_name IN ('auth_devices', 'auth_device_enrollments');

DROP TABLE IF EXISTS auth_device_enrollments;
DROP TABLE IF EXISTS auth_devices;
