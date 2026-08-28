# Sesión activa

## F191 — Organization Foundation v2 planning & reconciliation (#446/#447) — 2026-08-28

Rama `docs/446-organization-foundation-v2`.

Objetivo de la sesión: detener la expansión de nuevas familias persistentes hasta
cerrar correctamente Usuarios, Multi-Taller, tenant isolation y la Red de Ventas,
reconciliando el MVP de #325–#327 con el Digital Thread #384, catálogo #443 e
instalación #303.

### Auditoría y reconciliación del backlog

- #325, #326, #327, #421/#422 y #303 permanecen cerradas como baseline válido;
  no se reabren ni se declaran inútiles.
- No se encontró una issue abierta equivalente a RLS, membership lifecycle,
  last-admin, provisioning atómico u OrganizationRelationship.
- #443 fue adaptada para mantenerse catalog-local y consumir el contrato común
  de #448/#449; publication/subscription pertenece a #454.
- #384 recibió coordinación; conserva ownership de Project/FurnitureInstance/
  revisions/ProductionRelease.
- #385 fue adaptada para esperar Foundation Gate A y empezar con RLS, generated
  API, durable audit e upgrade fixtures desde su primera migration.
- #303 sigue siendo la única verdad de InstallationJob/visits/issues/punch;
  #457 sólo añade ownership/asignación cross-org.

### Issues creadas

- #446 — META Organization Foundation v2.
- #447 — canonical docs + ADR-0006.
- #448 — generated OpenAPI/errors/versioning/idempotency.
- #449 — tenant transactions + PostgreSQL RLS.
- #450 — invitation-first User/Membership/Invitation lifecycle.
- #451 — safe Team administration, last admin, offboarding, seats/sectors.
- #452 — Organization lifecycle + atomic provisioning.
- #453 — OrganizationRelationship + authorization.
- #454 — versioned CatalogPublication/subscription/overlays.
- #455 — wholesale/retail partner pricing.
- #456 — QuoteRevision → ManufacturingOrder handoff.
- #457 — InstallationOrder ownership/partner assignment over #303.
- #458 — tenant-safe React session/Team/Platform.
- #459 — complete Sales Network UX.
- #460 — bounded sessions, MFA, media/auth hardening.
- #461 — durable audit/outbox/observability.
- #462 — mandatory Foundation Gate A and Network Gate B.

#446 contiene invariantes, dependency graph, fases, trabajo paralelo permitido,
E2E global y Definition of Done.

### Documentación en esta rama

Creado:

- `docs/architecture/organization-foundation-v2.md`;
- `docs/adr/0006-membership-lifecycle-and-organization-relationships.md`.

Reconciliado:

- `docs/adr/0005-multi-organization-tenancy.md`;
- `docs/multi-organization-distribution-model.md`;
- `docs/architecture.md`;
- `AGENTS.md`;
- este ledger de sesión.

### Decisiones principales

1. `User` es identidad global; acceso, roles y sectores viven en `Membership`.
2. Onboarding B2B invitation-first; retirar aprobación global/InitialOrganization.
3. Toda org active conserva un admin mediante gate transaccional race-safe.
4. PostgreSQL FORCE RLS pasa a ser requisito Gate A, no hardening posterior.
5. Organization provisioning es idempotente y nunca deja active parcial.
6. Cross-org usa `OrganizationRelationship`; seller no pertenece a factory.
7. Factory catalog se publica por versions; store usa subscription + overlays.
8. FactoryCost, wholesale y retail tienen ownership/visibilidad separados.
9. Store submit crea ManufacturingOrder factory-owned mediante command idempotente.
10. Installation assignment puede pertenecer a factory/store/partner y reutiliza #303.
11. Go↔React usa OpenAPI generated, typed errors, ETag/If-Match e idempotency.
12. Critical mutation y audit/outbox confirman juntos.
13. React server state se keyea por organization y no usa fallback legacy.
14. Sesión absoluta de 18h de #441/#445 permanece; refresh no es sliding.
15. Gate A precede nuevas familias persistentes, incluyendo DT-1 #385; Gate B
    precede declarar Red de Ventas operable.

### Alcance de este PR

Sólo documentación, issues y governance. No cambia runtime, migrations, API ni UI.

### Próximo paso autorizado

Implementar #447 hasta mergear el contrato/ADR y readback. Después iniciar #448.
#449, #450 y la foundation de #461 pueden avanzar en paralelo únicamente después
de #448 y con coordinación explícita de migrations. No iniciar child issues que
salten hard prerequisites.

---

## F190 — validación real nativa + OpenCutList (#417) — 2026-08-28

Rama `test/417-native-ocl-validation`. Slice de validación test-only (cero
cambios en runtime): fixture canónico
`apps/sketchup-extension/test/fixtures/cabinet_validation_layout.json`
(gabinete 600×720×560 con BODY 16 / FRONT 18 / BACK 6, puerta + cajonero de 3
frentes con `componentDefinitionId` compartido, manija + 2 bisagras),
`TC_NativeValidationSmoke` (9 tests) y `TC_OpenCutListInteropSmoke` (1 test) en
host real, más test offline del fixture y boundary anti-OCL
(`opencutlist`/`ladb` prohibidos en `src/`).

Verificación: `bundle exec rake verify` verde (RuboCop 56 files, 170 unit /
1686 assertions, 3 boundary / 885, RBZ determinista `5fb741e9…` idéntico al
instalado); host smoke TestUp CI final **28/28 tests, 968 assertions, Success**
(seed 29189; 7 bootstrap + 11 native entity + 9 native validation + 1 OCL),
JSON preservado en `progress/host_smoke_F190_testup_ci.json`; reporte OCL
7.1.0 en `progress/opencutlist_smoke_F190.json`; resultados y limitaciones en
`docs/sketchup-opencutlist-interop.md`.

Hallazgos del host real: `editUndo:` es síncrono pero hubo un flake único del
test F188 de undo bajo suite completa (no reproducido aislado ni con la misma
seed; documentado, sin cambio de código); OCL analiza la selección si no está
vacía (el smoke la limpia); en SU 2026 `Length#to_s` sólo da mm decimales con
`LengthFormat` decimal + `LengthUnit` millimeter juntos; los relanzamientos
rápidos de SketchUp pueden crashear (signal 5) — se espacian las corridas.
