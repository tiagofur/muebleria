# ODD — #955 Standard publish surface + demo seed

- Issue: #955 (approved via owner's "arrancamos con C1" after the
  integral audit). Base: `origin/main` @ `8ecbbc28`. Worktree
  `../muebles-worktrees/c1-publish-surface`.

## Design

- Publish endpoints are Granete PLATFORM-STAFF only (the PlatformAdmin
  claim, not a tenant role): POST /standard/releases (create draft) and
  POST /standard/releases/{id}/publish (compile + atomic publish via
  application.PublishStandardRelease, now interfaced for stub tests).
- Demo seed (application.SeedDemoStandardRelease, hooked into HandleSeed
  after SeedCatalog, idempotent): ensures a Granete platform system user
  (publisher FK), ensures PERF-DEMO-MINIFIX-TAQUETE (minifix + tarugo,
  embedded recipe with front/back variants mirroring the verified #911
  contact classes, demo-grade dimensions documented for revision bump),
  and publishes the seeded Standard draft release through the REAL
  compiler — real manifest hash and content-addressed blobs, replacing
  the browser gate's placeholder-hash reality.

## Bug found and fixed by the integration test

The demo seed test failed on `demo.Recipe == nil`: migration 000143 and
the storage CRUD never gained the `recipe` column — #916 added the body
to the domain and release payload but the golden scenario used in-memory
stub data, so profiles with recipes could NOT persist. Migration
000145_hardware_profiles_recipe adds the JSONB column; storage
create/update/scan/ListActiveHardwareProfilesAnyOrg carry it. Full
storage suite green after the change (446s, real PostgreSQL).

## Tasks

- [x] PublishStandardRelease interfaced (StandardReleaseStore) + api
      Store/stubStore surfaces.
- [x] Handlers (platform gate, 201/200/400/403/404/409/422) + routes +
      OpenAPI (post merged into the releases path item; publish result
      schema) + regenerated clients, drift green.
- [x] Migration 000145 + storage recipe column + CRUD.
- [x] Demo seed + platform user helper + HandleSeed hook.
- [x] Tests: handler suite (gate/draft/publish paths), demo seed
      integration test (real publish, pinned read resolves recipe,
      idempotency).

## Evidence

- Go: storage full suite ok (446s); api/application/domain/engine ok;
  build ok. TS: typecheck 0. Drift ok.
- The demo chain now walks on real manifests: seed → published release →
  HardwareProfilesForRelease resolves PERF-DEMO with recipe → the
  #916/#949 resolve path consumes exactly this shape (golden 29 pins it).
- NOT_RUN locally: Foundation gates (CI for the exact HEAD).
