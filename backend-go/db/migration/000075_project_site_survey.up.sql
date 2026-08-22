-- OC-040/OC-041 (#305): structured site survey per project (spaces with field
-- measurements, openings/obstacles, utilities, plumb/level/square notes and
-- explicit capture/verify authorship) as a JSONB column on projects, same
-- convention as costing (000074). Writes only through the dedicated survey
-- endpoints; hardens the survey_verified release gate when present.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS site_survey JSONB;
