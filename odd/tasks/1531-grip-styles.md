# 1531 — Estilos de agarre (`grip_styles`)

Issue: #1531 (approved by the owner 2026-11-06). Lane: Delegated Direct (one
read-only Explorer for the blob/consumer map; this session is the only writer).
Base: `origin/main` 560d2a85. Branch: `feat/1531-grip-styles`.

## Scope (from the issue)
- New org-scoped table `grip_styles` with RLS, indexes, inventory, fresh + upgrade.
- Style = name, offered, isDefault (exactly one per org, DB-enforced) and one
  recipe per furniture type (inferior, superior, alto): handle | gola (top +
  optional between profile, usable at that position) | bottom_overhang (int > 0, 20 by default).
- CRUD with If-Match; the default cannot be deleted; durable audit in the same tx.
- Seed «Jaladera» (default) per org: backfill + trigger on new organizations.
- Migration from `opening.capabilities` + `opening.bottom-overhang` with a report;
  then nothing reads the blobs.

## Owner decisions (session 2026-11-06)
- Retire the blob readers with a projection: `GET /catalog/opening-capabilities`
  (SketchUp) and the design-opening write gate are derived from `grip_styles`;
  the old web settings section is replaced by a notice (UI is #1533).
- v1 bottom_overhang selections take the mm from the default style (that
  furniture type's recipe, then any offered style, then 20 per A4).

## Facts from exploration
- No outbox exists in the repo; durable audit = `security_audit_events` in the same tx.
- `POST /catalog/opening-configuration/validate` has no consumer besides tests → removed.
- No default handle hardware exists anywhere → `handleHardwareId` is optional.

## Tasks
- [x] T1 migration 000181 (table, RLS, inventory, grants, single-default index, seed, trigger, blob conversion + report, blob key removal)
- [x] T2 domain model + validation
- [x] T3 storage CRUD + audit + projection (capabilities, overhang)
- [x] T4 API + routes + OpenAPI + generated client
- [x] T5 retire blob readers (overlay namespace, validate endpoint, parsers, web section, e2e)
- [x] T6 PG tests: fresh/upgrade/re-pin, RLS cross-org + runtime direct SQL, default race, audit, rollback
- [ ] T7 verification + PR

## Evidence
- `go test ./internal/domain/... ./internal/api/ ./internal/application/`: ok.
- `backend-test.sh -run 'TestGripStyles|TestOpeningProfile|Overlay|…' ./internal/storage/`: ok (fresh/upgrade/down/re-apply; RLS, runtime SQL without BYPASSRLS, default race, audit, rollback).
- `pnpm typecheck`: green; domain 2164, ui settings 23, web 612, storage 286.
- Acceptance grep: no reader of the blob keys outside migrations, comments and rejection tests.
