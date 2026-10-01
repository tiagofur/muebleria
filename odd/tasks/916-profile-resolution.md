# ODD — #916 the resolve consumes pinned profiles and side assignments

- Issue: #916 (approved under the HW-PROFILE program; Phase-1 slice C,
  owner ratified plan 1B+2B with "arranca" 2026-10-01).
- Base: `origin/main` @ `aefa4d60` (post #947 pinning + #948 assignments).
- Worktree `../muebles-worktrees/916-profile-resolution`.

## Design decisions (ratified)

- 1B: the recipe BODY (per-target-face variants of complete rule sets)
  is embedded on the profile and travels in its release blob — one
  authoring surface; identity (recipeId+revision) agrees with recipeRef.
- 2B: the resolve synthesizes from the currently published Standard
  release (Phase-1 behavior; release id echoed in the response; the
  no-latest doctrine stays intact for historical design-publish pins).
- Injection happens BEFORE the normalized echo: TS parity holds with zero
  TS engine change (only fixture regen + validator field), and the echo
  becomes the next request's authored recipes (coherent with
  authored-override-wins).

## Tasks

- [x] Domain: ProfileRecipeBody/Variant/RuleSpec (mirrored wire, engine
      type frozen) + fail-closed validation wired into profile Validate;
      release payload carries the body.
- [x] Engine: ResolvedSideRecipe input + injection into recipe-less
      fixed-shelf-side relationships, all-or-nothing per relationship,
      authored-override-wins.
- [x] API: synthesis (assignments × pinned profiles), honest degradation
      (no release/manifest/profile -> terminal, logged), response
      libraryReleaseId.
- [x] Contract: golden 29 (ops identical to the authored 28, provenance,
      release echo; fixture additions-only), acceptedResponse schema +
      TS validator field, required-scenario lists, granete-api recipe
      schemas + clients, shared profile fixture recipe cases + TS twin.
- [x] Suites.

## Evidence

- Go: engine/domain/api suites ok; golden regenerated and idempotent;
  drift ok; build ./... ok.
- TS: schema+contract 26/26 (29 recomputed byte-for-byte from the echo);
  domain 1744/1744 incl. extended profile fixture; typecheck 0.
- Ruby: authoring_resolve_contract_test 49 runs / 540 assertions ok.
- Hand verification: 29 stations [30,261,492] both contacts, 4 ops with
  operation ids identical to authored 28, technicalProfileId = profile id.
- NOT_RUN locally: Foundation gates (CI); SketchUp host (no plugin change).
