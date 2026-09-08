DELETE FROM rls_policy_inventory WHERE table_name = 'design_pairing_grants' AND policy_version >= 2;

ALTER TABLE design_pairing_grants
    DROP CONSTRAINT IF EXISTS design_pairing_grants_confirm_after_exchange,
    DROP CONSTRAINT IF EXISTS design_pairing_grants_confirm_shape,
    DROP COLUMN IF EXISTS confirmed_at,
    DROP COLUMN IF EXISTS confirmed_by_session_id;

DROP INDEX IF EXISTS idx_design_pairing_grants_confirmed_by_session;

ALTER TABLE design_pairing_grants
    DROP CONSTRAINT IF EXISTS design_pairing_grants_exchange_shape;

ALTER TABLE design_pairing_grants
    ADD CONSTRAINT design_pairing_grants_exchange_shape CHECK (
        (status = 'exchanged') = (exchanged_at IS NOT NULL)
    );

ALTER TABLE design_pairing_grants
    DROP CONSTRAINT design_pairing_grants_status_check;

ALTER TABLE design_pairing_grants
    ADD CONSTRAINT design_pairing_grants_status_check
        CHECK (status IN ('pending', 'exchanged', 'cancelled'));
