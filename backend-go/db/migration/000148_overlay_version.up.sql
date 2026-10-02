-- 000148_overlay_version.up.sql
-- #875 slice 4 (AC07): two editors of one factory overlay must produce a
-- VISIBLE version conflict, never a silent last-write-wins. The monotonic
-- version column backs the same strong "v<N>" If-Match contract the modules
-- use: every overrides update bumps it, a stale token updates zero rows.

ALTER TABLE library_overlays
    ADD COLUMN version bigint NOT NULL DEFAULT 1;
