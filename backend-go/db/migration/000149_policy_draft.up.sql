-- 000149_policy_draft.up.sql
-- #875 slice 5: the construction policy draft/activate lifecycle. The draft
-- is staged on the SAME overlay row — never a new persistent family — while
-- the ACTIVE overrides keep governing every resolve until the explicit,
-- validated, atomic activation swaps them in one UPDATE.

ALTER TABLE library_overlays
    ADD COLUMN policy_draft JSONB NULL;
