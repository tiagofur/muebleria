# F192 — Tenant-scoped transactions and PostgreSQL RLS (#449)

Inicio: 2026-08-29 08:00 America/Mexico_City
Rama: `codex/449-tenant-rls`

Plan:

- inventariar y clasificar todas las tablas, ownership, policies e índices;
- introducir roles DB separados y un tenant transaction runner con `SET LOCAL`;
- habilitar y forzar RLS sin romper auth, soporte ni Project shared;
- retirar el fallback runtime a `InitialOrganizationID` y separar tooling admin;
- probar SQL directo, pool reuse, rollback, upsert, support/platform y readiness.

Prerequisites verificados: `origin/main` contiene PR #464 (`36d1295`), F191 está
`done` y #448 no se reabre ni reimplementa. Baseline al inicio: `./init.sh`
verde hasta las suites observadas; working tree limpio antes de activar F192.

Implementación lista para revisión independiente:

- migration `000094` con inventario exhaustivo, FORCE RLS, policies específicas,
  índices tenant-first y rollback probado;
- middleware/runner transaccional con actor revalidado y `SET LOCAL`, repositorios
  unidos a la transacción y rollback de respuestas 5xx;
- credenciales runtime/migrator separadas, startup readiness fail-closed y
  bootstrap Compose del rol sin ownership/BYPASSRLS;
- fallback runtime retirado, paths públicos/soporte/platform/catálogo adaptados y
  guard de arquitectura contra regresiones;
- SQL directo real, A↔B read/write/delete/upsert, shared Project, support,
  platform org-less, pool reuse, rollback, malicious body e inventory drift;
- runbook: `docs/postgresql-rls-operations.md`; performance:
  `progress/rls-performance-449.md`.

Evidencia local verde antes de review:

- `GOCACHE=/tmp/granete-go-cache go test ./... -count=1`;
- `pnpm openapi:check`;
- `pnpm typecheck`;
- `pnpm test`;
- `scripts/pilot-gate.sh --fresh-container` (SQL/RLS runtime + API + backup/restore);
- `docker compose config`, production compose config, shell syntax y
  `git diff --check`.

Correcciones tras review adversarial:

- hijos de Project shared sólo aceptan el `organization_id` primario del parent
  y triggers bloquean retargeting de organization/parent;
- support UPDATE distingue command platform org-less explícitamente autorizado
  de token support, que sólo puede mutar su sesión y organización;
- readiness recorre transitivamente `pg_auth_members` y rechaza cualquier rol
  heredado privilegiado o propietario de tablas protegidas;
- rollback `000094` queda acotado a su inventario, elimina todos sus índices,
  preserva RLS/policies ajenos y tiene round-trip aislado verificable;
- negative proofs nuevos cubren insert/update hacia Org C, support A→B y
  membresía runtime en un rol owner.
