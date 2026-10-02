-- 000148_furniture_instances_authoring_snapshot.up.sql
-- #977: deleting a furniture unit in SketchUp drops its design working item
-- (#810 Caso 1) — the only durable carrier of the authored material choices,
-- lineage modes and parameters. Re-placing the surviving FurnitureInstance
-- then seeded finishes from a quote line the project may not have, so the
-- unit re-entered without its finishes. The last known authoring state is now
-- snapshotted onto the instance (same transaction as the working-copy update
-- that drops the item), and the placement lanes read it back when the live
-- working item is gone.
--
-- Column only: ownership, RLS policies and grants are inherited from
-- furniture_instances (000111). The snapshot is internal recovery plumbing —
-- writers leave version/updated_at untouched so a background sync can never
-- poison a concurrent instance command's If-Match with a version conflict.

ALTER TABLE furniture_instances
    ADD COLUMN authoring_snapshot jsonb;

COMMENT ON COLUMN furniture_instances.authoring_snapshot IS
    '#977 last known authoring state {parameters, material_choices, material_choice_modes} captured when a design working-copy update drops the item; recovery seed for re-placement, never user-visible identity';
