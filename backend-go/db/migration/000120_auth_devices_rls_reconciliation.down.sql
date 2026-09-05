-- #560 down: revert reconciled RLS policies for auth_devices and auth_device_enrollments.
-- Drops the 000108 policies and restores the initial select_own_* policies.

DROP POLICY IF EXISTS auth_device_read ON auth_devices;
DROP POLICY IF EXISTS auth_device_insert ON auth_devices;
DROP POLICY IF EXISTS auth_device_update ON auth_devices;

CREATE POLICY select_own_auth_devices ON auth_devices
    FOR SELECT TO PUBLIC
    USING (user_id = current_setting('app.current_user_id', true)::UUID);

DROP POLICY IF EXISTS auth_device_enrollment_read ON auth_device_enrollments;
DROP POLICY IF EXISTS auth_device_enrollment_insert ON auth_device_enrollments;
DROP POLICY IF EXISTS auth_device_enrollment_update ON auth_device_enrollments;

CREATE POLICY select_own_auth_device_enrollments ON auth_device_enrollments
    FOR SELECT TO PUBLIC
    USING (user_id = current_setting('app.current_user_id', true)::UUID);
