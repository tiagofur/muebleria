# Feature en curso: F197 — Corrección de support sessions y lifecycle (#452 / PR #484)

- Inicio: 2026-08-30 America/Mexico_City
- Rama: `feat/452-organization-lifecycle-provisioning`
- Base verificada: `main@d85d6fd21aa040c4d1f08c5c76c0ab099db7c83b`
- Head inicial verificado: `1d3916b3a216e4b9575b3b34db7a386b3f1771af`

## Ejecución

- Serializar start de soporte y lifecycle con el mismo lock de Organization.
- Vincular sesión y token de soporte al credential version persistido.
- Revalidar sesión, actor, organización, estado y epochs en cada request.
- Hacer start/logout/offboarding auditables y transaccionales.
- Probar concurrencia PostgreSQL real, migrations, auth, HTTP y gates completos antes de nueva revisión independiente.

## Estado verificado

- Corrección implementada con migration head `000102_support_session_credential_epoch`.
- Concurrencia real cubre ambos órdenes de commit y nunca deja una sesión abierta después de suspender.
- `pnpm openapi:check`, `git diff --check`, `./init.sh` completo en PostgreSQL 16 aislado y `scripts/pilot-gate.sh --fresh-container` pasaron.
- Pendiente: publicar el nuevo head y recibir una nueva revisión independiente; el approval anterior no aplica a esta corrección.
