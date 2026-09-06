-- #571 / WEB-DT-4: drop the single-accepted-quote backstop.

DROP INDEX IF EXISTS uq_quote_revisions_one_accepted_per_project;
