# ODD — #914 hardware profiles catalog UI

- Issue: #914 (approved; Phase 2 slice 1, owner directive "vamos a Fase 2"
  2026-10-01).
- Base: `origin/main` @ `15d35784` (post #951). Worktree
  `../muebles-worktrees/914-hardware-profiles-ui`.

## Design

- Screen cloned from the canonical HardwareCatalog pattern (pure
  props+callbacks, CatalogTable/PageHeader/EmptyState, one contextual
  primary action); data via the generated client through a dedicated hook
  (the useFactoryConstructionPolicy precedent), not the whole-catalog
  store.
- The modal's item lines pick EXISTING catalog hardware (canonical
  code+price shown read-only per line) — no second product list; prices
  never copy into the profile.
- Validation rides the frozen #912 domain twin (unique code, required
  name/revision, ≥1 item, no duplicate hardware ids, positive quantities).
- Stale-write UX: 412 keeps the modal + draft with the reload message;
  the list row's `version` is the If-Match authority; a refetch after
  every accepted write keeps rows fresh.
- Recipe bodies stay a Granete-managed release surface — read-only note
  in the form (assignment (#915 UI) and recipe authoring are later
  slices).

## Tasks

- [x] Screen + modal + draft + tests (7: list, create with items,
      duplicate-code rejection, zero-quantity rejection, 412 stale UX with
      draft intact, deactivate with row version, canMutate read-only).
- [x] useHardwareProfiles hook + registration (nav id, CATÁLOGOS sidebar,
      route /hardware-profiles, RBAC catalog grant, ShellView branch).
- [x] Suites.

## Evidence

- V0: typecheck 0 errors workspace-wide.
- V1: screen tests 7/7; ui catalogs+settings 138/138; web suite 565/565.
- V2: browser gate NOT_RUN locally (CI Foundation browser proofs for the
  exact HEAD cover the real-browser requirement; this slice adds no
  backend behavior).
