-- #1512 M3: per-hand assets of a multi-design hardware — one catalog row with
-- its SKP per side instead of duplicated -I/-D rows. Nullable JSONB: nil =
-- symmetric/legacy. Writes carry identifiers only (assetId/assetRevisionId);
-- representation/sha/mountFrame facts are server-resolved on read, same
-- contract as the visual_asset columns (#667). No new table: no RLS surface.
ALTER TABLE hardwares
    ADD COLUMN IF NOT EXISTS hands JSONB;
