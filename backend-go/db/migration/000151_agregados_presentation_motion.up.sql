-- 000151_agregados_presentation_motion.up.sql
-- #529: presentation opening kinematics authored on the Agregado in the
-- catalog UI (rotate pivot left/right with openAngleDeg, translate for
-- drawers, keyframed lift paths). Presentation-only: hosts replay it as a
-- transient visual pose; never read by BOM, machining, pricing or release
-- capture. Column only: ownership, RLS policies and grants are inherited
-- from the agregados base table.
ALTER TABLE agregados
    ADD COLUMN presentation_motion jsonb;

COMMENT ON COLUMN agregados.presentation_motion IS
    '#529 presentation opening kinematics {kind: rotate|translate|keyframes, ...}; transient visual pose in hosts, never manufacturing truth';
