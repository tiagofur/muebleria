# Feature en curso: F197 — Lifecycle explícito y provisioning atómico de organizaciones (#452)

- Inicio: 2026-08-30 America/Mexico_City
- Rama: `feat/452-organization-lifecycle-provisioning`

## Plan

- Reemplazar `organizations.active` por lifecycle, readiness y epoch organizacional canónicos.
- Unificar Platform, Factory y CLI en provisioning PostgreSQL transaccional e idempotente.
- Extender la autoridad de entitlements y añadir suspensión, reactivación y offboarding seguros.
- Publicar el contrato OpenAPI generado y adaptar la UI mínima sin invadir #458.
- Probar migrations, RLS, concurrencia, API, auth y UI antes de revisión independiente.
