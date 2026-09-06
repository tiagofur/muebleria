-- #571 / WEB-DT-4: durable backstop for the single-accepted-quote invariant.
--
-- The commercial Digital Thread admits at most ONE accepted QuoteRevision per
-- project: acceptance of a new revision supersedes the previously accepted one
-- atomically in the same transaction (#393 / ADR-0003 §25). The lifecycle
-- trigger (000116/000117) validates per-row transitions but cannot express the
-- project-level invariant, and no previous migration enforced it. This partial
-- unique index is the minimal durable backstop: even a caller bypassing the
-- AcceptQuoteRevision command can never leave two accepted revisions behind.
--
-- The index is NOT deferrable (partial unique indexes cannot be), so the accept
-- command must supersede the previous accepted revision BEFORE accepting the
-- target — the command's documented order.

CREATE UNIQUE INDEX uq_quote_revisions_one_accepted_per_project
    ON quote_revisions(project_id)
    WHERE status = 'accepted';
