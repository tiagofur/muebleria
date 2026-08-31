# Feature en curso: F199 — Tenant-safe Team, Organization and Platform UX (#458)

- Inicio: 2026-08-30 America/Mexico_City
- Rama tracker: `feat/458-tenant-safe-organization-ux`
- Base verificada: `main@72dd224167adb6e4fa92abf28c70fbc8d587561c`

## Ejecución

- Introducir server state tenant/session-scoped y un transport generado abortable detrás de `SessionCoordinator`.
- Hacer atómico el cambio de organización, la limpieza de cache/stores/media y la coordinación multi-tab/drafts.
- Migrar Team/Invitations y Platform a adapters/hooks tipados, commands autoritativos y estados honestos.
- Añadir read models mínimos, accessibility/responsive, negative guards y browser E2E real sin invadir #459–#461.
- Mantener la feature `in_progress` hasta verificación completa y revisión independiente.

## Baseline

- PR #492 corrigió F197/current y PR #486/F198 mergeó como `72dd224167adb6e4fa92abf28c70fbc8d587561c`.
- `scripts/pilot-gate.sh --fresh-container` pasó sobre PostgreSQL 16 y migration head `00103`.
- El PostgreSQL local persistente está drifted (schema ledger en 00101 sin trigger de 000094); no se ejecutó SQL destructivo y las pruebas de feature usarán infraestructura fresca aislada.
