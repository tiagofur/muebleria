-- #499 / DT-SU-1 (Slice 3): pairing grant confirmation.
--
-- `exchanged` proves the SketchUp extension consumed the one-time code and
-- received the exact authorized context. It does NOT prove the model binding
-- was persisted: that happens client-side in the .skp dictionary (#388).
-- `confirmed` closes that gap: only the SAME device session that exchanged
-- the grant may confirm, after the extension persisted AND read back the
-- canonical com.granete.project binding with the exact project/design/base
-- the grant pinned. The confirm payload carries exact persisted IDs (never
-- model data); the server re-checks them against the grant row.
--
-- Classification stays tenant-owned (000124); this migration only adds the
-- terminal state and its attribution columns.

ALTER TABLE design_pairing_grants
    DROP CONSTRAINT design_pairing_grants_status_check;

ALTER TABLE design_pairing_grants
    ADD CONSTRAINT design_pairing_grants_status_check
        CHECK (status IN ('pending', 'exchanged', 'confirmed', 'cancelled'));

-- 000124 tied exchanged_at to status='exchanged' exactly; the confirmed
-- terminal state keeps the exchange attribution forever, so the exchange
-- shape widens to both consumed states.
ALTER TABLE design_pairing_grants
    DROP CONSTRAINT design_pairing_grants_exchange_shape;

ALTER TABLE design_pairing_grants
    ADD CONSTRAINT design_pairing_grants_exchange_shape CHECK (
        (status IN ('exchanged', 'confirmed')) = (exchanged_at IS NOT NULL)
    );

ALTER TABLE design_pairing_grants
    ADD COLUMN confirmed_at TIMESTAMPTZ,
    ADD COLUMN confirmed_by_session_id UUID REFERENCES auth_sessions(id),
    ADD CONSTRAINT design_pairing_grants_confirm_shape CHECK (
        (status = 'confirmed') = (confirmed_at IS NOT NULL AND confirmed_by_session_id IS NOT NULL)
    ),
    ADD CONSTRAINT design_pairing_grants_confirm_after_exchange CHECK (
        status <> 'confirmed' OR exchanged_at IS NOT NULL
    );

-- Confirm lookups start from the exchanging device's own session.
CREATE INDEX idx_design_pairing_grants_confirmed_by_session
    ON design_pairing_grants(confirmed_by_session_id)
    WHERE status = 'confirmed';

INSERT INTO rls_policy_inventory (table_name, classification, read_scope, write_scope, rationale)
VALUES
 ('design_pairing_grants', 'tenant-owned', 'owner-organization-or-platform', 'owner-organization-or-platform', 'One-time Web-to-SketchUp handoff claims scoped to the exact org/project/design (#499); the confirmed terminal state is attributable to the exchanging device session only (Slice 3 initiated-vs-confirmed proof)')
ON CONFLICT (table_name) DO UPDATE SET
 classification = EXCLUDED.classification,
 read_scope = EXCLUDED.read_scope,
 write_scope = EXCLUDED.write_scope,
 rationale = EXCLUDED.rationale,
 policy_version = rls_policy_inventory.policy_version + 1,
 updated_at = NOW();
