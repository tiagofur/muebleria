# ODD — #915 UI: per-face assignments in the component editor

- Issue: #915 (approved; Phase 2 slice 2 — completes the issue's UI
  acceptance together with slice B's backend PR #948).
- Base: `origin/main` @ `57e7177a` (post #952 catalog UI).
- Worktree `../muebles-worktrees/915-side-assignments-ui`.

## Design

- Panel inside the CONSTRUCTION tab (same six-face semantics as the #943
  joinery panel): one row per canonical board face with a profile picker
  (active profiles only, code+name+revision) and "Quitar" per assigned
  face (restore inheritance). Selecting the inherited option also removes.
- IMMEDIATE-WRITE semantics: assignments are a per-entity REST resource,
  NOT part of the whole-catalog draft — no setDraft; every change PUTs or
  DELETEs right away and the list refetches.
- Save-first UX: the editor's editingId is route-driven; new components
  (`/new`) have no server row, so the panel shows "Guardá el componente
  para asignar perfiles por cara". Guest sessions get the auth hint.
- Vocabulary stays canonical: callbacks use the domain BoardFace union;
  face labels reuse the joinery panel's Spanish labels.
- Threading: apps/web hook (useComponentSideAssignments, mirroring
  useHardwareProfiles) instantiated in ShellView (route-driven id),
  bundle passed ShellView → ComponentsScreen → ComponentEditorForm →
  panel; profile picker options from the useHardwareProfiles hook (#952).

## Contract fix found by the generated client

The generator ignores query parameters, so the DELETE's `side` query
param never reached the TS client (the UI would 400). Moved `side` to the
PATH (DELETE /api/catalog/components/{id}/side-assignments/{side}) across
handler, route, OpenAPI and regenerated client — the generated signature
now carries the typed side enum. Go handler tests updated to the path
form.

## Tasks

- [x] Hook + panel + threading + registration.
- [x] Contract fix (path-param DELETE) + regenerated clients + drift ok.
- [x] Panel tests 7/7 (faces, set, remove, inherited-select removal,
      save-first hint, auth hint, error surface); Go handler tests to the
      path form; suites.
- [x] PR Refs #915 partial→(with #948's backend the issue's acceptance is
      fully covered; closing scope documented in the PR).

## Evidence

- V0: typecheck 0 errors; drift ok.
- V1: Go api/application/domain/engine ok; panel tests 7/7; ui editor
  suite 17/17; web 565/565; domain 1744/1744; Ruby not touched.
- V2: Foundation gates in CI for the exact HEAD.
