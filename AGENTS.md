# AGENTS.md — Mapa de navegación

Granete conecta venta → diseño → ingeniería → producción para carpinterías y
fábricas pequeñas/medianas. Prioridad: DEMO integrada → MVP para dos prospectos.
Este archivo es el mapa de entrada, no el PRD ni una instrucción de releer el repo.

## Arranque y autorización

1. Lee la issue exacta, su aprobación, aceptación, exclusiones, base y PR existentes.
2. Lee la skill de tu rol y `docs/demo/software-factory-human-start.md`.
3. Ejecuta `python3 scripts/factory_preflight.py`; para entregar usa además
   `--require-clean`. No instala, no ejecuta tests y NO autoriza escribir.
4. Consulta `progress/current.md` y ownership/reserva vigentes sin sobrescribir
   trabajo ajeno. GitHub Issues es la única cola; el ledger sólo conserva historia.
5. Lee las fuentes **del área afectada** y sus prerequisites. No reinicies programas
   ya implementados ni selecciones la primera feature pendiente del ledger.

`./init.sh` conserva su comprobación completa histórica para uso explícito. No es
el arranque rutinario del agente. Comandos locales y CI proporcional:
`docs/demo/software-factory-human-start.md` § Verificación proporcional.

## Roles y áreas

| Rol / área | Lectura obligatoria aplicable |
| --- | --- |
| Líder | `.agents/skills/leader/SKILL.md` |
| Implementador (por defecto) | `.agents/skills/implementer/SKILL.md` |
| Revisor independiente | `.agents/skills/reviewer/SKILL.md` |
| Arquitectura / convenciones | `docs/architecture.md`, `docs/conventions.md` |
| Producto / prioridad | `docs/prd-v2.md`, `docs/roadmap-comercial-v2.md`, `docs/demo-mvp-plan-2026-09-05.md` |
| Users / Auth / Memberships / Organizations / Sales Network | `docs/architecture/organization-foundation-v2.md`, ADR-0005, ADR-0006, #446 y child exacta, proofs #462 |
| Librerías de manufactura / releases / overlays / distribución local | `docs/architecture/manufacturing-library-platform.md`, ADR-0008; además `parametric-furniture-library.md` y `3d-asset-library.md` cuando toque definiciones/assets |
| Project / FurnitureInstance / Design / Q-R-P | `docs/architecture/project-design-digital-thread.md`, ADR-0003, #384; cliente generado #496 |
| Integración SketchUp ↔ Go ↔ React | `docs/architecture/sketchup-backend-web-integration-excellence.md`, #465 y contrato generado #496 |
| Mutación / interacción SketchUp | `apps/sketchup-extension/AGENTS.md`, contrato de autoría/nativo, runtime #498; no coordinadores por feature |
| UI React | Secciones pertinentes de `docs/design.md`; su §8 completo al cerrar UI; `docs/operational-ux.md` en pantallas operativas |
| Proyectar | `docs/proyectar-3d-north-star.md` y documentos de performance/usabilidad cuando afecte sus hot paths |
| Producción / lifecycle | `docs/production-flow-v2.md`, `docs/project-lifecycle.md` |
| Export / máquina | `docs/verification.md`, contratos y perfiles/adapters del receptor exacto |
| Verificación / release | `docs/verification.md`, `docs/pilot-readiness.md`, aceptación específica de la issue |

El mapa detallado y las reglas de cada dominio del AGENTS anterior se conservan
**sin borrar contenido** en `docs/demo/software-factory-agent-reference.md`.
Lee sus secciones aplicables cuando trabajes en esos dominios. Sus instrucciones
históricas de arranque y repetición de suites quedan sustituidas por este mapa y el
contrato actual de inicio humano; sus invariantes de producto no se relajan.

## Invariantes que nunca se omiten por eficiencia

- Aprobación humana de alcance; un escritor salvo coordinación explícita, rama
  aislada, no tocar reservas ni trabajo de otros. Sin force push ni merge automático.
- No `done`, cierre por API ni PASS inventado; publicación y readback exactos.
  `Closes/Fixes/Resolves + Delivery: complete` sólo con DoD completo;
  `Refs + Delivery: partial` conserva alcance restante explícito.
- Server authority para seguridad, sesiones, concurrencia, tenant scope, stock,
  lifecycle y workflow persistente. React no recrea resolve/pricing/preflight.
- No mezclar estados de account, membership, organización, cotización, proyecto,
  diseño, orden o ejecución. No inventar hechos/fechas/métricas ni usar `createdAt`
  para suplir silenciosamente el evento real; distinguir actual/estimated/missing.
- APIs/DTOs generados; fixtures de paridad cuando una regla viva en TS y Go.
  Sin fallback silencioso a legacy, IDs derivados de nombres/geometría ni `latest`
  implícito en revisiones, approvals, releases, artifacts o fabricación.
- Librerías de manufactura: no duplicar el catálogo canónico por cliente; releases
  publicados son inmutables, proyectos fijan `effectiveLibraryReleaseId`, overlays
  se resuelven en backend con conflictos explícitos y `LibraryStore` persistente no
  se trata como cache descartable. Free/Standard comparten recursos canónicos.
- Auth + capability + ownership + RLS. Tenant ID no autoriza. Runtime DB sin
  BYPASSRLS ni ownership; `SET LOCAL` transaccional; sin InitialOrganization fallback.
  Audit/outbox durable con la mutación; idempotencia/If-Match donde corresponda.
- Toda tabla nueva: clasificación de ownership, RLS/índices, fresh+upgrade,
  direct-SQL bajo runtime role, generated API y pruebas de carrera/rollback.
  Gate A integrado no se reinicia; Gate B sigue exigible donde gobierna.
- Sesiones/credenciales Web y SketchUp distintas. Pairing exacto, one-time y corto;
  sin JWT web en URI/query. Estado React keyed por sesión/tenant; late responses
  no cruzan contexto. La sesión absoluta de 18h no se extiende con refresh técnico.
- Resolve/preparación antes de mutar host; no destruir geometría válida ante fallo.
  ComponentInstance nativo, IDs comerciales exactos, atomicidad/undo y contexto
  fresco. Material/espesor efectivos antes de geometría. Host real no es un stub.
- Corte/CNC/Enchape trabajan piezas; Armado converge a muebles/unidades/bultos.
  No fabricación contra revisión stale ni compatibilidad de máquina inferida.
  Claim físico requiere profile/adapter/version/readback y evidence pack exactos.
- UI: tokens, copy español, una primary action contextual, estados
  loading/error/stale/offline/blocked distintos; a11y y comportamiento demostrados.
  Código/identificadores en inglés; pnpm only para JS.
- Nada de secretos/PII ni `.env` en git o diagnósticos. Sin SQL destructivo sin
  confirmación y backup; seed demo explícito. No usar `git stash` como depósito.
- Pruebas exigidas por la issue siguen obligatorias, incluidas browser real,
  PostgreSQL/RLS, TestUp y readback de máquinas cuando apliquen. Infraestructura
  ausente es BLOCKED/NOT_RUN, no un PASS ni licencia para omitir el control.

## Mapa físico

`apps/web` shell React; `apps/sketchup-extension` Ruby/HtmlDialog/TestUp;
`apps/desktop` Electron; `apps/mobile` React Native; `packages/domain` lógica pura;
`packages/ui` React compartido; `packages/excel` exports; `packages/storage` clientes,
repos y mappers; `backend-go` API/services/PostgreSQL; `contracts` schemas/fixtures.

Conflictos documentales: verifica código/tests, distingue implemented de target y
corrige la fuente adecuada sin revertir implementación moderna por texto histórico.
No conviertas este mapa en otro manual ni leas el archivo de referencia completo
por rutina: conserva foco, trazabilidad y todas las reglas aplicables.
