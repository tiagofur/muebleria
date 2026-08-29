# Feature en curso

**F193 — Lifecycle explícito de identidad y membresía con onboarding invitation-first (#450)**

- Inicio: 2026-08-29 10:20 America/Bahia_Banderas
- Rama: `feat/450-invitation-membership-lifecycle`
- Base: `b4f8e7eaaea99fa0515085b46a8f2038858c57ae`

## Plan

1. Inventariar y retirar registro/aprobación global, mutaciones por `userId` y callers de `InitialOrganizationID`.
2. Migrar User, Membership e Invitation a lifecycles explícitos con email normalizado, historial, constraints y RLS reconciliado.
3. Publicar el contrato OpenAPI generado y ejecutar create/resend/revoke/accept de invitaciones dentro de las transacciones F192.
4. Migrar Login, aceptación y Team al cliente generado, estado tenant-keyed y presentación separada de account/membership.
5. Probar fresh/upgrade/rollback, concurrencia, idempotencia, cross-org y legacy negative proofs; documentar evidencia y preparar entrega.
