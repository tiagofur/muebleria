# ODD — #917 hardware demand from resolved profiles

- Issue: #917 (approved under the HW-PROFILE program; Phase-1 slice D,
  owner directive "sigamos con D" 2026-10-01).
- Base: `origin/main` @ `c5103afe` (post #949 profile resolution).
- Worktree `../muebles-worktrees/917-profile-bom`.

## Design decision (fixed before coding)

The commercial projection lands in the AUTHORING resolve response as
`machining.hardwareProfileDemand`: for every relationship that reached
MACHINING_READY through server-resolved profiles, each VERIFIED contact
consumes one application of that profile's items, aggregated by catalog
hardware id with a per-relationship provenance trail. Deliberate
boundaries:
- Source = the profile RESOLUTION (assignments × pinned items), never
  the drilling output — a hardware producing five operations is one
  purchase line (the double-count acceptance is structural).
- Prices/codes stay out: the demand carries ids + quantities; the
  hardware catalog joins price at consumption time.
- Outside the manufacturing fingerprint: commercial demand is not
  machining identity (same ops with different assignments keep the
  fingerprint; the demand explains the difference).
- Wiring the demand into the PROJECT release BOM (ResolvedBom.HardwareLines)
  is remaining scope — the project resolve path does not yet load
  org assignments/pins; this slice ships the authoritative projection.

## Tasks

- [x] Engine: HardwareProfileDemandLine/Source types + field on
      AuthoringMachining (omitempty; api fills it post-resolve).
- [x] API: deriveHardwareProfileDemand (READY relationships × VALID
      contacts × profile items, aggregated, deterministic order,
      provenance trail); wired in the handler.
- [x] Contract: resolvedMachining schema + demand defs; TS validator
      fail-closed when present; golden regenerated — ONLY scenario 29
      changed (its demand: 4× hardware = 2 per contact × 2 verified
      contacts, provenance trail; scenario 28's synthetic profile is not
      pinned so no demand — proving the pinned path is the source).
- [x] Suites.

## Evidence

- Go: golden regenerated and idempotent; engine/domain/api suites ok;
  build ./... ok.
- TS: schema+contract 26/26; domain 1744/1744; typecheck 0.
- Ruby: 49 runs / 540 assertions (machining hash tolerates the new
  sibling key; operations parsing unchanged).
- Acceptance: composite profile quantities exact (item quantities ×
  contacts); no per-operation double count (contact-level derivation);
  two independent contacts sum; duplicate occurrence duplicates contacts
  (occurrence-scoped contacts, pinned by golden 29 + 28 identity); no
  price/code in demand; machining output is not the commercial source
  (28 without pin has no demand, 29 with pin does).
- NOT_RUN locally: Foundation gates (CI); project-BOM wiring (remaining
  scope, named).
