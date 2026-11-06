-- #1518 F1 reversal: rebuild hands (left/right only) from pieces, then drop.
ALTER TABLE hardwares
    ADD COLUMN IF NOT EXISTS hands JSONB;

UPDATE hardwares
SET hands = sub.hands
FROM (
    SELECT h.id AS hid,
           jsonb_strip_nulls(jsonb_build_object(
               'left',  CASE WHEN h.pieces @> '[{"anchor":"left"}]'  THEN jsonb_build_object('asset', (SELECT jsonb_build_object('assetId', p->'asset'->>'assetId', 'assetRevisionId', p->'asset'->>'assetRevisionId') FROM jsonb_array_elements(h.pieces) p WHERE p->>'anchor' = 'left'))  END,
               'right', CASE WHEN h.pieces @> '[{"anchor":"right"}]' THEN jsonb_build_object('asset', (SELECT jsonb_build_object('assetId', p->'asset'->>'assetId', 'assetRevisionId', p->'asset'->>'assetRevisionId') FROM jsonb_array_elements(h.pieces) p WHERE p->>'anchor' = 'right')) END
           )) AS hands
    FROM hardwares h
    WHERE h.pieces IS NOT NULL
) AS sub
WHERE hardwares.id = sub.hid
  AND hardwares.hands IS NULL;

ALTER TABLE hardwares
    DROP COLUMN IF EXISTS pieces;
