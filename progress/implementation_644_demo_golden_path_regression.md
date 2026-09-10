# Issue #644 — [P0][DEMO] Golden path regression: Quote → SketchUp → DesignRevision → ProductionRelease

## Correction delivery (2026-09-10)

- Tested implementation commit: `7b74985d7c62f3f17a2b13dcc48a9a7f0ad0ae50`.
- Exact merge base: `fde538a839a7b882657fafbfe41bbdd1cf91fbee`.
- Correction diff: 3 files, 171 insertions, 55 deletions; complete PR diff
  against main remains test-only (3 files).
- `pnpm typecheck`: PASS.
- `git diff --check`: PASS.

- Verification lane (`status:approved`). Test-only: **zero product files changed.**
- Branch `test/644-demo-golden-path-regression`, original implementation head
  `9661df177748d69b020dda29962f2ca88713818d`, merged with exact
  `origin/main@fde538a839a7b882657fafbfe41bbdd1cf91fbee` through merge commit
  `b2dde534cd7e3fd264283e2d55adbbf2d54ebb4d` (includes #639 / PR #646).
- Deliverable: `tests/organization/demo-golden-path.spec.ts` — ONE canonical
  deterministic kitchen-quote fixture driven through the REAL supported stack
  (browser React + Go API + PostgreSQL + artifact filesystem). Extends the
  existing organization gate (`scripts/organization-browser-gate.sh`); no
  parallel framework, no SQL bypass, no mocks.

## Scenario fixture

Realistic kitchen "Cocina Dorada DEMO" with a golden-specific catalog (never
shared with other gate specs):

- **Furniture A** — Gabinete Cocina Dorada (600×720×590), **quantity = 2**,
  quoted choices `{GOLD-INTERIOR: GOLD-TAB-ARA-BLA, GOLD-FRENTE: GOLD-TAB-MAD-FRE}`.
- **Furniture B** — same definition, **quantity = 1**, quoted choices
  `{GOLD-INTERIOR: GOLD-TAB-ROB, GOLD-FRENTE: GOLD-TAB-MAD-FRE}`.
- 3 board components (1 frente + 2 interiores per unit) with real materials,
  option groups and component `optionRoles` — the exact mapping the
  manufacturing resolver consumes.
- Choice keys deliberately carry a `GOLD-` prefix so this fixture can never
  collide with `OPS`/`REC` option groups in the shared gate database.

## Stage matrix (final run, ephemeral real Chromium + Go + PostgreSQL)

| Stage | Result | Evidence class |
|---|---|---|
| 1 Quote (Q1 draft→published→accepted) | PASS | REAL GO + POSTGRESQL |
| 2 Physical instances (qty=2 → 2 distinct ids, quoted display) | PASS | REAL GO + POSTGRESQL |
| 3 First Design (base null, zero revisions, Web handoff) | PASS | REAL BROWSER + GO + POSTGRESQL |
| 4 Pairing (grant base=null, extension exchange, confirmed, replay rejected) | PASS | REAL BROWSER + GO + POSTGRESQL (extension credential; SketchUp-host dictionary half remains TestUp-owned) |
| 5 Working copy (exact identity, quoted finishes, definition_version integer-or-omitted) | PASS | REAL GO + POSTGRESQL (authoring contract payload; Ruby serialization is RUBY CONTRACT) |
| 6 Publish R1 (#633 multipart SketchUp contract, parent null) | PASS | REAL GO + POSTGRESQL + artifact filesystem (`.skp` bytes are a CI stand-in — licensed host execution NOT PROVEN in CI) |
| 7 Artifact readback (signed grants, `/api/design-artifacts/`, no `/api/api`) | PASS | REAL GO + POSTGRESQL |
| 8 R2 (parent=R1, R1 API snapshot semantically stable, isolated change, Web lineage) | PASS | REAL BROWSER + GO + POSTGRESQL |
| 9 Approval (gate rejects outdated Q1 → requote Q2 → accept → approve R2 vs Q2) | PASS | REAL GO + POSTGRESQL |
| 10 ProductionRelease (exact R2+Q2 pin, frozen routing v2, `${release}:${instance}:u1` units, 9 parts) | PASS | REAL GO + POSTGRESQL |

Correction run after #639:

- focused `scripts/organization-browser-gate.sh tests/organization/demo-golden-path.spec.ts`:
  **10/10 PASS**;
- full `pnpm test:organization:browser`: **36 PASS, 2 FAIL, 3 NOT RUN** in
  1.7 min. The failures were outside this PR's file: the reconciliation
  workspace and a later Web auth login timed out waiting for their route/topbar
  elements. The focused golden stayed green inside the same full run. This run
  is not misreported as green.
- independent focused recheck of both affected specs through the same ephemeral
  browser gate (`project-reconciliation.spec.ts` + `webauth.spec.ts`):
  **11/11 PASS** in 38.0s. The two visibility timeouts were not reproducible and
  are not caused by the golden fixture; exact-head Actions remain the final gate.

## Assertion strength after #639

- Q1 now fails unless all three immutable per-unit items carry exact module,
  `{widthMm:600,heightMm:720,depthMm:590}`, lifecycle and the exact two material
  choices (2× A, 1× B).
- FurnitureInstance display and Design working copy assert those same exact
  dimensions and choices; material loss is no longer a note-only finding.
- R1 and R2 both require `descriptor_state=available`, definition name+code,
  parameter labels+units+values, material name+code+18 mm+`quoted` provenance,
  plus their exact raw choices.
- Renaming the module and three materials after R1 proves R1's API projection
  remains semantically equal and retains its original labels, while R2 freezes
  the new labels. This proves historical immutability without claiming byte
  identity for a decoded API response.

## Truth observations

- `Project.status`: stays **`draft`** after QuoteRevision acceptance; only a
  separate legacy project save (`status: 'accepted'`) unlocks operational
  stages.
- `QuoteRevision`: Q1 draft→published→accepted; requote + Q2 acceptance
  atomically **supersedes** Q1 (#571 semantics; exactly one accepted baseline).
- `DesignRevision`: R1 stays `published` while R2 is `approved`; no implicit
  approval cascade.
- `ProductionRelease`: `active`, pinned to exact R2 + exact Q2.
- **FOUND_DOUBLE_TRUTH: yes** — "accepted" exists twice (QuoteRevision.status
  since stage 1 AND legacy Project.status set separately for operational
  stages). Recorded, not fixed. Feeds the planned QuoteRevision lifecycle issue.
- Q1 snapshot **does** carry per-unit `materialChoices` on current main (the
  old "#571 Q1 has no choices" limitation is gone).
- Issue #644's literal ProductionRelease pin `R2 + Q1` is stale against the
  integrated #502 safety gate: R2 changes quoted commercial reality, so Q1 is
  rejected. The golden explicitly derives and accepts Q2 from exact R2, then
  pins `R2 + Q2`; weakening that gate to satisfy the literal would be wrong.

## Material provenance (12 records, all exact)

Quoted → instance display → working copy → R1 → R2 for all 3 units: **zero
loss, asserted**. Every surface carries the exact quoted
`{GOLD-INTERIOR, GOLD-FRENTE}` per unit.

- **FOUND_MATERIAL_PROVENANCE_LOSS: no** on a FRESH quote-first flow. The #637
  repair lane remains necessary only for units connected before #621 (frozen
  `{}` in existing working snapshots); this regression proves the fresh path
  is clean and freezes that guarantee.

## Test and gate findings

The focused golden has no blocker. Every mid-run failure was a test-fixture bug (short idempotency key <
16 chars; `display` read from the workspace payload instead of the
furniture-instances list surface (#389); missing per-test browser login;
approval attempted against the outdated Q1 baseline — which correctly
exercised the #502 gate; Q1 supersede semantics; choice keys not matching
component `optionRoles`). The two behavior refusals (outdated-baseline
approval, forged part-execution payloads elsewhere in the suite) are the
gates working as designed and are now permanent regression assertions. The
full-suite correction run still records the two visibility timeouts above, so
that run is not claimed green; both affected specs passed their independent
11/11 recheck through a fresh Go + PostgreSQL + Chromium environment.

## Product files changed

NONE. Relative to main the PR changes only
`tests/organization/demo-golden-path.spec.ts` and two progress documents.

## Verdict

**GOLDEN PATH PASS** on the supported stack. SketchUp-host execution (licensed
2026 desktop, save/reopen, TestUp) remains RUBY CONTRACT / NOT PROVEN in CI by
design of this lane — the real-host gate stays #354's program.
