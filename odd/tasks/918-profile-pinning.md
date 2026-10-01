# ODD — #918 Hardware Profiles pinning via library releases

- Issue: #918 (approved 2026-09-30 under the HW-PROFILE program
  authorization; owner ratified the Phase-1 plan and the Standard-profiles
  design decision with "luz verde").
- Lane: ODD. Worktree `../muebles-worktrees/918-profile-pinning`.
- Base: `origin/main` @ `29b5fa84` (post #943/#945/#946 merges).

## Facts established (audit @ 29b5fa84)

- The release compiler (`CompileLibraryRelease`, application/library_compiler.go)
  and atomic publisher (`PublishReleaseWithManifest`,
  storage/manufacturing_library_publish.go) exist, are kind-agnostic
  (`resource_kind` free TEXT) and tested — but have ZERO production
  callers: the publish surface does not exist. The seed release
  `00000000-0000-0000-0002-000000000001` (000139) is an empty DRAFT with
  NULL manifest hash; on a fresh DB no published release exists, so
  `GetEffectiveReleaseForOrg` fails and every design revision publishes
  with a NULL pin + warning (designs.go:948).
- The pin is WRITE-ONLY today: `design_revisions.effective_library_release_id`
  is set at publish (designs.go:943-966) and read back into the struct,
  but nothing joins pin → manifest → blobs. No `latest` read exists on
  this path either.
- Pinned-read primitives exist and have production consumers:
  GetReleaseManifest / GetResourceBlob(WithEntitlementCheck) serve the
  distribution API (#773) and the overlay rebase (#775).
- hardware_profiles (#945): org-scoped rows, no release linkage. Items
  reference catalog hardware by id; revision is a required non-blank
  string (contract #912).
- Tenancy model (platform doc §4.2-4.3, ADR-0008): Standard is
  Granete-managed and immutable upstream; factory customization rides the
  organization OVERLAY (`joint.*` etc.), never a copy or a second release
  system. `LibraryKindPrivate` is explicitly future.

## Design (frozen with the owner)

1. **Standard profiles are Granete-authored catalog rows** promoted into
   Standard releases as kind `hardware_profile` (id = profile id,
   revision = profile revision, definitionHash = canonical JSON digest).
   Factory-specific parameterization stays in the overlay; factory profiles
   do NOT enter Standard releases in this slice.
2. **Publish surface**: admin-only `POST /api/manufacturing-libraries/standard/releases`
   (create draft: version + changelog) and
   `POST .../releases/{id}/publish` (compile + atomic publish; 409 on
   already-published/withdrawn). Compilation gathers:
   canonical `hardware` rows (existing canonical entities, status
   `active`) as kind `hardware`, and `hardware_profiles` (active, any
   org) as kind `hardware_profile` with `resource_revision = profile
   revision`. Any active profile failing `domain.Validate()` fails the
   compilation fail-closed (structured, with profile code).
3. **Pinned read (no latest)**: `GetHardwareProfilesForRelease(releaseID)`
   resolves kind refs → blobs → `domain.HardwareProfile[]` (fail-closed on
   malformed blob). This is the function #916 will consume with the design
   pin; the slice also exposes it through a read endpoint pinned by
   release id (never "current" — clients that want current must resolve
   the release id explicitly first).
4. **Pinning tests** (the issue's acceptance): profile v1 stays resolvable
   at release R1 after a v2 exists and after R2 publishes; hardware price
   change does NOT change the profile blob hash (blob contains ids only);
   recipeRef revision change DOES change the hash (technical invalidation)
   while being honest that fingerprint plumbing lands with #916.

## Tasks

- [ ] WU1 application: `HardwareProfileResourcePayload` (canonical JSON
      shape = domain wire, ids only) + `CompileStandardRelease` gathering
      active hardware + active profiles; fail-closed validation.
- [ ] WU2 storage: `GetHardwareProfilesForRelease` + `ListActiveProfilesAnyOrg`
      read helpers (admin context) as needed by the API.
- [ ] WU3 API: create-draft + publish handlers (admin/Granete gate,
      idempotent-safe statuses, OpenAPI paths + regenerated clients).
- [ ] WU4 tests: pinning semantics (v1-at-R1 stability, price immutability,
      recipe bump moves hash), publish idempotency/duplicate-resource
      errors, blob round-trip through the distribution API surface.
- [ ] WU5 ODD evidence + work-unit commits + PR (Closes #918 complete).

## Evidence log

- 2026-09-30 startup: preflight OK @ 29b5fa84; no other writer on these
  files; publish surface confirmed absent (builds the audit's item 1).
