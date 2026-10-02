# ODD — #919 [P1][HW-PROFILE] Golden vertical slice — cabinet → profile → contact → machining + BOM

**Issue**: https://github.com/tiagofur/muebleria/issues/919
**Status**: PLANNED (2026-10-02, G-ODD 4.0 Delegated Direct; plan reported before code per contract)
**Lane**: Delegated Direct — one artifact
**Base**: `origin/main` @ `9b74d99d` (post-#963 + post-#965 G-ODD 4.0)
**Branch (planned)**: `feat/919-hw-profile-golden-vertical`
**Writer**: GLM (ZCode)

---

## 1. Outcome

One reproducible golden proving Granete can declare, from a single domain
model: **what hardware to buy + where it applies + what operation to
fabricate** — for a representative cabinet, with expectations computed
INDEPENDENTLY by hand (never only from the resolver's own output).

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

- [ ] **T1 — hand-computed golden fixture**
  `contracts/hardwareProfileVertical.golden.json`: scenario inputs (catalog
  slice, assignments, profile, policy) + EXPECTED outputs with the
  arithmetic documented inline: per-contact station positions; per-hole
  (face, position, diameter, depth); demand lines; BOM boards + hardware
  lines with unit prices; requirements lines. No resolver-generated numbers
  enter this file by construction.
- [ ] **T2 — Go golden test**: resolve the scenario and match the golden
  exactly (operations per piece/contact with provenance profile+recipe
  revision; demand; BOM/requirements). Failures are golden defects OR
  resolver bugs — never silently regenerated.
- [ ] **T3 — TS parity**: same fixture consumed by the TS side
  (`sketchupAuthoringResolve.contract.json` pattern).
- [ ] **T4 — mutation isolation**: move / duplicate / delete / reorder
  occurrences + profile change + recipe-revision bump: only the related
  pieces/lines move; a revision bump changes the technical fingerprint;
  unrelated operations are untouched.
- [ ] **T5 — fail-closed pins**: missing profile/recipe →
  `TECHNICAL_PROFILE_REQUIRED` → no-fabricable (release blocked); BOM and
  machining stay distinct authorities (demand derives from profile
  RESOLUTION, never from drilling output).
- [ ] **T6 — evidence**: V0 (typecheck/drift) + V1 (Go engine + TS domain
  suites). V2 NOT_RUN — the issue explicitly does not require SketchUp host
  or PTX for the neutral engine.

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
