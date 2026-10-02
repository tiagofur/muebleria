# ODD — #964 [P2][LIB] Per-org provisioning of recipe-bearing profiles

**Issue**: https://github.com/tiagofur/muebleria/issues/964
**Status**: PLANNED (2026-10-02, G-ODD 4.0 Delegated Direct; plan reported before code)
**Lane**: Delegated Direct — one artifact
**Base**: `origin/main` @ the merge of #967 (branch from post-merge main)
**Branch (planned)**: `feat/964-per-org-profile-provisioning`
**Writer**: GLM (ZCode)
**Approval note**: the issue carries no `status:approved` label yet — the owner's
green light on this plan comes with the label + traceability comment
(precedent #961/#920).

---

## 1. Outcome

Two factories can EACH hold a recipe-bearing hardware profile pinned in the
published Standard release, with their own side assignments — so the #875 A/B
acceptance (A=4 / B=2 over the same Standard definition) and the full
hardware-profile vertical run against real, per-org provisioned truth
instead of a single-org seed.

## 2. Root cause (verified against code + isolation test evidence)

- `hardware_profiles.id` is a GLOBAL primary key with org-scoped rows:
  a second organization INSERTing the seed's FIXED `SeedDemoProfileID`
  collides on the PK → the `/seed` 500 under factory B.
- `validateAssignmentReferences` correctly rejects cross-org profile
  references (proven by `TestReleaseServerInputsTenantIsolation`).
- The publisher compiles the manifest from
  `ListActiveHardwareProfilesAnyOrg` — **every active profile of every org**
  is carried by one publication. No builder change needed.
- Therefore: per-org provisioning = per-org DETERMINISTIC ids for the demo
  hardware + profile copies, created before a single publication.

## 3. Design

- **Provisioning function** (application layer, platform-staff gated like
  today's publication path): for each requested organization id, idempotently
  create the org-scoped copies of the demo hardware rows (minifix + taquete)
  and the demo profile WITH its verified recipe body, using deterministic
  per-org ids (`uuid.NewMD5`/`uuid5` over (orgID, fixed demo id) — stable
  across calls, distinct across orgs).
- **`POST /api/seed` extension**: platform-admin callers may pass an
  `organizationIds` list in the body (default: the caller's org — the current
  single-org behavior is preserved for every existing caller). For each org
  the provisioning runs; then ONE real publication carries all provisioned
  profiles. Non-platform callers keep today's exact behavior (profile in
  their org, no publication) — never a permission widening.
- **Invariant kept**: recipes are canonical content of the published release
  (platform authority); assignments stay factory-scoped catalog truth. The
  #955 surface (org admins author profiles WITHOUT recipes) stays closed.

## 4. Acceptance → tasks

- [ ] **T1 — root-cause pin**: storage test asserting the fixed-id collision
  (second org INSERT of `SeedDemoProfileID` → unique violation), documenting
  the 500.
- [ ] **T2 — per-org deterministic provisioning**: application function +
  tests: same org twice → same ids, no duplicates (idempotent); two orgs →
  distinct ids, each row org-scoped, recipe body intact.
- [ ] **T3 — one publication carries all orgs**: after provisioning A and B,
  `PublishStandardRelease` manifest contains BOTH profiles;
  `HardwareProfilesForRelease` resolves both; each org's assignments
  synthesize their own recipes through `ReleaseServerInputsFromStore`
  (extends `TestReleaseServerInputsTenantIsolation` to two GOVERNED orgs).
- [ ] **T4 — seed endpoint**: platform admin + `organizationIds` → both orgs
  provisioned and published in one call, idempotent on re-call; non-platform
  caller unchanged (single-org, no publication). Handler tests.
- [ ] **T5 — browser gate (V2)**: the #875 A/B real case — extend
  `factory-construction-policy-resolve.spec.ts`: A and B each hold their own
  provisioned profile + assignments; BOTH resolve MACHINING_READY with their
  own station policy (A=4 / B=2) over the same Standard definition; the
  fingerprints differ across factories.
- [ ] **T6 — evidence**: V0 (typecheck/drift) + V1 (Go application/storage/
  api suites with disposable PostgreSQL; TS untouched unless the client adds
  the seed body param) + V2 browser gate above.

## 5. Non-goals

No org-authored recipe surfaces; no changes to the recipe contract or the
#955 permission model; no OperationID/identity changes; no PTX/SketchUp; no
changes to the release freeze semantics (#963).

## 6. Delivery strategy

Single candidate on `feat/964-per-org-profile-provisioning` from post-#967
main; work-unit commits (root-cause pin → provisioning → publication →
endpoint → gate); frozen V0–V2 evidence; handoff to a fresh reviewer.
`Closes #964 + Delivery: complete` only with the A/B browser gate green;
otherwise `Refs + partial` naming the remainder.

## 7. Risks

- Cross-org writes need real platform authority inside tenant RLS: the
  provisioning must run under the platform-admin path the publish flow
  already uses (same mechanism as #955), never by loosening RLS.
- Deterministic ids must be stable across gate reruns (uuid5, not random) —
  a different scheme would orphan previous assignments.
- The demo profile's per-org copies multiply with every provisioned org;
  acceptable for the gate scale, documented for the real catalog (#903
  dossier lane supersedes demo profiles eventually).
