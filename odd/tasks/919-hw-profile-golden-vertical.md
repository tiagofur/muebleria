# ODD — #919 [P1][HW-PROFILE] Golden vertical slice — cabinet → profile → contact → machining + BOM

**Issue**: https://github.com/tiagofur/muebleria/issues/919
**Status**: IMPLEMENTED_PENDING_REVIEW — Delivery **partial** (review pass 3, 2026-10-02: golden re-scoped to contact-level per owner review; cabinet vertical + occurrence mutations = remaining scope)
**Lane**: Delegated Direct — one artifact
**Base**: `origin/main` @ `9b74d99d` (post-#963 + post-#965 G-ODD 4.0)
**Branch (planned)**: `feat/919-hw-profile-golden-vertical`
**Writer**: GLM (ZCode)

---

## 1. Outcome (re-scoped per review pass 3 — Path B)

A CONTACT-LEVEL hardware-profile machining golden: hardware-profile →
governed contact → stations → machining operations → provenance →
demand/BOM arithmetic, with expectations computed INDEPENDENTLY by hand.
The TRUE cabinet vertical (one representative entity traversing
layout → contacts → machining → BOM connected) is REMAINING SCOPE of
#919, together with the occurrence-level mutations (move, duplicate,
delete, reorder, profile switch) the issue lists — this delivery pins the
engine contract the cabinet vertical will stand on.

## 2. Golden scenario

Cabinet 600×720×560 (structure 18 mm): 2 laterales (`PH-2*T × PD`), base
(`PW-2*T × PD-T`), tapa, 1 entrepaño fijo, respaldo — the issue's exact
board list. Governed joints available in the domain today:
- base → laterales: **floor-side**
- entrepaño → laterales: **fixed-shelf-side**
- tapa (top-to-side) y respaldo (back-panel): boards in the BOM; their joint
  kinds are #874 deferred work — they carry BOM truth but no governed
  machining in this golden (scope note, not a gap of this slice).

Profile: the ONLY technically verified recipe body existing in the repo —
`PERF-DEMO-MINIFIX-TAQUETE` (Granete-authored, seeded, real publication,
productive PTX gate #793). The issue's `PERF-SPAX` is an example name;
`PERF-SPAX-50` exists only as the #912 domain contract fixture without a
production recipe body. Policy: library defaults (2 stations, 50/50) unless
the hand computation pins otherwise.

## 3. Authority

- `docs/architecture/hardware-profiles.md` (#920 canonical) + #912 contract.
- The resolver contracts in main: #916 side recipes, #917 demand, #875 policy
  governance + release freeze.
- Independent arithmetic: station positions from the documented pattern
  (margins + even distribution over the contact span), hole geometry from the
  recipe rules (entry face, offset, axis, diameter, depth), demand = profile
  items × verified contacts (#917), BOM from the catalog definitions with
  prices from Hardware.CostPerUnit. The fixture carries the arithmetic as
  documentation so a reviewer can re-derive every number.

## 4. Acceptance → tasks

- [x] **T1 — hand-computed golden fixture**
  `contracts/hardwareProfileVertical.golden.json`: contact scenario with
  identity bases (every number derivable on paper), stations (count 2,
  margins 30/30 over [0,100] → distances 30/70), recipe rules with ASSEMBLY
  frame axes (cam (0,-1,0) projects to +Z; dowel (0,1,0) projects to the
  contact normal), 4 expected holes with absolute local centers, mutation
  cases, fail-closed expectation, demand arithmetic (items × 2 contacts)
  and BOM board/pricing documentation. NO resolver-generated numbers.
- [x] **T2 — Go golden test**
  (`hardware_profile_vertical_golden_test.go`): station distances exact,
  4 operations matched on (participant, rule, station) with absolute local
  centers + axis + provenance (profile+recipe revision), mutations
  (margins/count redistribution/revision bumps with geometry-unchanged +
  operation-identity change), demand (minifix 2, dowel 4), fail-closed
  without profile (TECHNICAL_PROFILE_REQUIRED, zero operations), mutation
  ISOLATION across two contacts, and demand cost arithmetic (unit price ×
  quantity, no double counting).
- [x] **T3 — TS parity** (`hardwareProfileVerticalGolden.test.ts`): the TS
  mirror (`deriveFixedShelfOperations`) reproduces the SAME hand-computed
  numbers from the same fixture: MACHINING_READY, station distances 30/70,
  holes (30,9)/(70,9) per face/diameter/depth, provenance (technical
  profile + recipe revision + catalogRuleId = recipe id). 3/3.
- [x] **T4 — mutation isolation**: margins/count redistribution +
  revision bumps (geometry-unchanged, identity moves) + two-contact
  isolation (mutating contact 1 leaves contact 2 byte-identical).
- [x] **T5 — fail-closed pins**: no verified profile →
  TECHNICAL_PROFILE_REQUIRED + zero operations (no-fabricable); demand
  derives from the profile RESOLUTION per verified contact (#917),
  station-independent.
- [x] **T6 — evidence**: V0 typecheck clean (domain) + engine suite green;
  V1: Go engine full + TS domain 124 files / 1754 tests. V2 NOT_RUN — the
  issue explicitly does not require SketchUp host or PTX for the neutral
  engine. The release-level integration of the same governed chain carries
  its own real-PG evidence in PR #963 (freeze + isolation tests).

**Golden findings during implementation** (the fixture corrected ITSELF,
never the resolver): two hand-arithmetic errors were caught and fixed in
the fixture — the rule axis is an ASSEMBLY-frame direction projected
through (along, normal, cross), and the dowel axis must project onto the
contact normal. Both are now documented in the fixture.

## 5. Non-goals

No SketchUp host, no PTX/machine formats, no new industrial rules, no #874
closure, no multi-org provisioning (#964 owns the A/B demo). The golden does
not replace the #963 browser gates; it complements them with absolute
hand-computed values.

## 6. Delivery strategy

Single candidate on `feat/919-hw-profile-golden-vertical`, work-unit commits
(fixture → Go golden → TS parity → mutations/fail-closed), frozen V0/V1,
handoff to a fresh reviewer with exact HEAD/base. `Closes #919 +
Delivery: complete` only with every acceptance box demonstrated; otherwise
`Refs + partial` naming the remainder.

## 7. Risks

- The hand computation must reproduce the resolver's coordinate frames for
  hole positions; if they disagree, the delta is the finding (golden defect
  or resolver bug) — resolved by evidence, never by bending rules (#919's
  own "no cambiar reglas industriales").
- The tapa/respaldo scope note must be visible to the reviewer to avoid an
  overclaim on "flujo completo".
