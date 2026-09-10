# Issue #644 — [P0][DEMO] Golden path regression: Quote → SketchUp → DesignRevision → ProductionRelease

- Verification lane (`status:approved`). Test-only: **zero product files changed.**
- Branch `test/644-demo-golden-path-regression`, exact base `origin/main@55399890`
  (merge of PR #638; includes #636 merged 2026-09-09 and #638 merged 2026-09-10 —
  no active overlapping PRs at run time).
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
| 8 R2 (parent=R1, R1 byte-identical, isolated change, Web lineage) | PASS | REAL BROWSER + GO + POSTGRESQL |
| 9 Approval (gate rejects outdated Q1 → requote Q2 → accept → approve R2 vs Q2) | PASS | REAL GO + POSTGRESQL |
| 10 ProductionRelease (exact R2+Q2 pin, frozen routing v2, `${release}:${instance}:u1` units, 9 parts) | PASS | REAL GO + POSTGRESQL |

`pnpm test:organization:browser` full gate: **41/41 PASS (1.8 min)** — the new
spec coexists with every existing organization spec.

## Scenario ids (final run)

- project: `77777777-4444-4777-8777-444444444444` (deterministic)
- Q1: `5c654fbd-ede0-4b95-b5c7-c52579af80be` → accepted → **superseded** after Q2
- Q2: `da5cf11e-0cbf-4514-aab0-deb9d93c168f` → accepted
- furniture instances: `6fab41ed-…`, `9857bb29-…` (qty=2 line), `d8cad010-…` (qty=1 line)
- design: `c3115eef-a2cf-45f7-ae8a-6b0c98f3b466`
- R1: `73ba37c3-aefa-4bed-ba4f-12f9242de232` (source_type=sketchup, parent null, published)
- R2: `c337c6de-5106-43a3-b1c3-92966f2023f5` (parent=R1, approved)
- release: `48eab1d9-83fd-4365-83b9-db61ef43720e` (P1, active, frozen_routing=true)

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

## Material provenance (12 records, all exact)

Quoted → instance display → working copy → R1 → R2 for all 3 units: **zero
loss**. Every surface carries the exact quoted
`{GOLD-INTERIOR, GOLD-FRENTE}` per unit.

- **FOUND_MATERIAL_PROVENANCE_LOSS: no** on a FRESH quote-first flow. The #637
  repair lane remains necessary only for units connected before #621 (frozen
  `{}` in existing working snapshots); this regression proves the fresh path
  is clean and freezes that guarantee.

## Blockers found

None. Every mid-run failure was a test-fixture bug (short idempotency key <
16 chars; `display` read from the workspace payload instead of the
furniture-instances list surface (#389); missing per-test browser login;
approval attempted against the outdated Q1 baseline — which correctly
exercised the #502 gate; Q1 supersede semantics; choice keys not matching
component `optionRoles`). The two behavior refusals (outdated-baseline
approval, forged part-execution payloads elsewhere in the suite) are the
gates working as designed and are now permanent regression assertions.

## Product files changed

NONE. `git diff main --stat` → only `tests/organization/demo-golden-path.spec.ts`
and this progress document.

## Verdict

**GOLDEN PATH PASS** on the supported stack. SketchUp-host execution (licensed
2026 desktop, save/reopen, TestUp) remains RUBY CONTRACT / NOT PROVEN in CI by
design of this lane — the real-host gate stays #354's program.
