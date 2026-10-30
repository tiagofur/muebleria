# Stateless clean-context review protocol

Code review is the factory's quality firewall. Review fails when the reviewer
shares the implementer's conversational memory. This document defines the
clean-context contract behind checkpoint C4 in `CHECKPOINTS.md` and the
independent-review section of the [portable G-ODD contract](software-factory-human-start.md).
It does not replace that contract; it pins how a fresh reviewer stays fresh.

## 1. Why clean context is mandatory

Over a long implementation an agent's context fills with intermediate
hypotheses, rationalized shortcuts, and happy-path framing. If review runs in
that same context — or reads the implementer's transcript — the reviewer
evaluates the *plausibility of the implementer's story* instead of the
*correctness of the diff against the approved issue*.

> **The clean-context rule**: the reviewer is a fresh actor with zero
> implementer chat messages, zero intermediate reasoning logs, and zero
> unpublished scratch notes. The leader hands over an exact, pinned candidate —
> never a narrative.

This is why one issue has one writer and a *different fresh actor* reviews; a
self-review or a transcript-forwarded review is a protocol violation and its
`APPROVED` is void.

## 2. Deterministic review bundle (`scripts/factory_review_bundle.py`)

Instead of conversational context, the reviewer receives a deterministic bundle
generated from git state:

```bash
python3 scripts/factory_review_bundle.py \
  --base origin/main --head HEAD --issue <N> --output-md /tmp/review-<N>.md
```

The bundle pins:

1. **Pinned identity**: `base_sha`, `head_sha`, and a `scope_sha256` computed
   over the issue number, both SHAs, the sorted changed-path list, and the
   SHA-256 of the full diff. Any later commit invalidates the digest — a new
   HEAD requires a fresh bundle and a fresh review.
2. **Objective change surface**: changed-file list and `git diff --stat`.
3. **High-risk triggers**: detected from changed paths and file names, driving
   `judgment_day_required` (§5).
4. **The full diff** when written to file.

The bundle contains no chat history, no implementer rationale, and no
verification claims; observed V0/V1/V2 evidence travels beside it, reported by
the implementer and re-checked by the reviewer.

**Relation to `scripts/factory_handoff.py`**: that script is the advisory
exact-PR evidence handoff described in `docs/verification.md` — it observes the
remote PR/issue scope and never dispatches, approves, or reviews. Receipt-driven
review remains off unless a human explicitly enables it. The review bundle is
likewise advisory: it freezes what the reviewer inspects; it does not approve,
reserve, or merge anything.

## 3. Severity rubric (P0–P3)

| Severity | Blocks? | Definition |
| --- | --- | --- |
| **P0 — Blocker** | YES | Security/RLS/tenant-scope vulnerability, data loss or corruption, broken build or test, out-of-scope file mutation, silent violation of an ADR, generated-contract drift, or a violated domain invariant from `AGENTS.md` (always P0). |
| **P1 — Critical** | YES | Unmet acceptance criterion, unhandled negative path, fabricated/stale/empty evidence, missing required NOT_RUN declaration, or missing regression test for changed behavior. On `ux:shape` PRs, missing `## Visual Evidence` or divergence from the published UX brief is at least P1. |
| **P2 — Improvement** | No | Non-blocking maintainability, naming, or minor performance note. |
| **P3 — Nit** | No | Trivial style or documentation observation. |

Every P0/P1 finding must cite exact `path:line`, a concrete failure scenario or
violated rule, and a minimal correction. Speculative stylistic preference
without a citable rule cannot block.

## 4. Verdict and bounded correction

One terminal verdict per pinned candidate: `APPROVED` (zero P0/P1 and evidence
matching the claim), `CHANGES_REQUESTED` (any P0/P1), or `BLOCKED` (missing
proof, invalid pins, or environmental blocker). Concrete blockers are
consolidated into **at most one correction round** followed by one scoped
re-review of the new HEAD. A blocker that survives the correction round goes to
the human — stop/narrow/extend is a human decision, never loop-until-green.

## 5. Automatic `judgment-day` escalation

Routine work gets one clean-context reviewer. When the pinned diff touches a
high-risk boundary, or a correction round already failed with a remaining
P0/P1, the leader escalates to
**blind dual review**: two independent read-only judges receive the identical
frozen bundle without seeing each other's output; both must confirm a finding
before it blocks, and contradictions escalate to the human.

Triggers:

1. Auth, sessions, credentials, tenant scope, or RLS behavior.
2. Database migrations (`backend-go/db/migration/`) or destructive data paths.
3. Shared contracts and TS↔Go parity fixtures under `contracts/`, or generated
   API surface changes.
4. Factory guardrails: `scripts/`, `.github/workflows/`, `CHECKPOINTS.md`,
   `AGENTS.md`, `.github/PULL_REQUEST_TEMPLATE.md`, or the `.agents/skills/`
   contract.
5. Any PR exceeding the ~400 authored-line review budget (`chained-pr` slices).
6. Any candidate that failed one correction round and still carries a P0/P1.
