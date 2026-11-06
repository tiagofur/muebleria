-- #1518 F1: generalized design pieces replace the two-hand hands column.
-- Each piece carries its own anchor (left|right|center) and optional x/y/z
-- offsets interpreted FROM its side (left→min, right→max, center→center).
-- Backfill transforms hands {left:{asset},right:{asset}} (identifiers-only)
-- into pieces [{anchor,asset}] verbatim; single-piece rows are unaffected
-- (no pieces column value = symmetric/legacy hardware).
ALTER TABLE hardwares
    ADD COLUMN IF NOT EXISTS pieces JSONB;

UPDATE hardwares
SET pieces = sub.pieces
FROM (
    SELECT h.id AS hid,
           jsonb_agg(
               jsonb_build_object(
                   'anchor', e.key,
                   'asset', jsonb_build_object(
                       'assetId', e.value->'asset'->>'assetId',
                       'assetRevisionId', e.value->'asset'->>'assetRevisionId'
                   )
               ) ORDER BY e.key
           ) AS pieces
    FROM hardwares h,
         LATERAL jsonb_each(h.hands) AS e(key, value)
    WHERE h.hands IS NOT NULL
      AND e.value->'asset'->>'assetId' IS NOT NULL
      AND e.value->'asset'->>'assetRevisionId' IS NOT NULL
    GROUP BY h.id
) AS sub
WHERE hardwares.id = sub.hid
  AND hardwares.pieces IS NULL;

ALTER TABLE hardwares
    DROP COLUMN IF EXISTS hands;
