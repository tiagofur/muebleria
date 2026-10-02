# ODD — #964 [P2][LIB] Per-org provisioning of recipe-bearing profiles

**Issue**: https://github.com/tiagofur/muebleria/issues/964
**Status**: IMPLEMENTED_PENDING_REVIEW (2026-10-02, G-ODD 4.0 Delegated Direct; plan approved — `status:approved` + traceability comment on the issue)
**Lane**: Delegated Direct — one artifact
**Base**: `origin/main` @ `54ef1083` (merge of #967)
**Branch**: `feat/964-per-org-profile-provisioning` (created)
**Writer**: GLM (ZCode)

## Execution record (2026-10-02, T1–T6 evidence)

- T1–T4 as designed, with one implementation deviation: `POST /api/seed`
  provisions the CALLER's org (`SeedDemoForOrg`); the `organizationIds` body
  param was not needed — per-org ids are deterministic (`uuid.NewMD5`) and
  the publication carries EVERY org's active profiles, so repeated per-org
  seeds compose into one manifest.
- T5 debugging surfaced TWO further root causes beyond the original
  fixed-id collision, both fixed:
  1. the first per-org id mapping pass was incomplete — the fresh seed
     branch still inserted MOD-COMP-001, the demo project/item/template and
     the whole plinth surface (zoclo hardware, ZOCLO groups, zoclo
     component, plinth modules) with FIXED global-PK ids (second-org
     `modules_pkey`/`projects_pkey`/… collisions). All now derive ids via
     `SeededIDForOrg`; upgrade upserts keep their `(organization_id, code)`
     targets so existing installations preserve fixed-id rows.
  2. the publish compile ran inside the publisher's tenant tx, where
     000143's strictly org-scoped `hardware_profiles_read` RLS policy made
     `ListActiveHardwareProfilesAnyOrg` see only the publisher's org — the
     manifest silently missed the second factory's profile and its resolve
     stayed at TECHNICAL_PROFILE_REQUIRED. **000147** widens the READ with
     the transactional `app.platform_admin` marker (#955/000146 idiom);
     writes and tenant reads stay org-scoped. The multi-org test now
     publishes under a REAL tenant tx with a platform actor and asserts org
     B resolves its own recipe (the assertion gap that hid the bug).
- Observability: the tenant-transaction wrapper logs the captured handler
  failure (status/body/request id) instead of converting a handler 5xx into
  an unattributable generic 500.
- V2 evidence: `organization-browser-gate.sh
  factory-construction-policy-resolve.spec.ts` → 3/3 PASS (A and B resolve
  MACHINING_READY under ONE published Standard revision, A=4 / B=2, distinct
  fingerprints; B's `/seed` returns 200 with its own provisioned profileId).
  Full org suite 105/106: the one failure
  (`hardware-3d-catalog.spec.ts` step 8) is the #667 M2 vendedor mutation
  protection assertion, which passed VACUOUSLY while org B's catalog was
  empty (the second-org /seed 500 this issue fixes) and now surfaces a real
  latent UI gap — a real vendedor (created by
  `prepareAuthoritativeOrganizations`, read back via API) sees hardware
  "Editar" affordances after the A→B org switch while the server correctly
  answers 403. Outside this issue's scope; owner decision on the follow-up.
- V1 evidence: `TestProvisionDemoProfileMultiOrg` (RLS real, strengthened),
  `TestDemoSeed*` green against disposable PostgreSQL; full storage package
  green (470s); full backend green except the storage expectation migrated
  in this branch (re-run green); pnpm typecheck + recursive tests green;
  OpenAPI drift negative.

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
