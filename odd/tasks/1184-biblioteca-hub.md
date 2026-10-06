# ODD — #1184: hub Biblioteca del ciclo de revisiones + línea contextual mínima

- Issue: #1184 (abierta con `status:approved` esta sesión; decisión del owner
  2026-10-06: opción E de la evaluación del stack de revisiones).
- Lane: Delegated Direct (trabajo multi-archivo con valor de recuperación).
- Base: `main` @ `b18af877`. Rama: `feat/1184-biblioteca-hub`. Un escritor.
- Preconditions verificadas: bug "Probar borrador" ya arreglado en #1174
  (PR #1175, en la base); gates API de biblioteca son API-level (no dependen
  del render que se reorganiza).

## Alcance autorizado (ejecutado completo)

1. ✅ Nav id `library` + ruta `/library` + ítem "Biblioteca" (primero en
   LIBRERÍA, área oliva heredada), visible sólo platform admin
   (`allowedNavIds` en AppContent + caso especial en `navBlockedForSession`,
   paridad con `platform`).
2. ✅ `LibraryWorkspaceScreen` (`packages/ui/src/library/`): hub con
   PageHeader + ScreenBoundary + los 4 componentes existentes reutilizados sin
   cambios de comportamiento (historial con nueva prop `defaultOpen` en el
   hub) + modal de publicación (estado `libraryPublishOpen` movido desde
   ShellView al hub).
3. ✅ `LibraryDraftContextLine`: reemplaza al stack en las 10 superficies de
   autoría; una línea delgada sólo con borrador abierto y sin error de
   workspace, link real `Ir a Biblioteca →` (href, middle-click); sin
   borrador no renderiza nada.
4. ✅ El contrato de edición no cambia: `useStandardLibraryWorkspace`
   intacto; ShellView pasa el workspace al hub por props.

## Exclusiones (explícitas en la issue, sin cambios)

Gestión de borradores múltiples (sólo `draftReleases[0]`, como hoy);
withdraw/rollback/changelog (Fase 2); pins reales por organización; plugin;
sesiones S17-S25 de #1100 (el owner las frena hasta este merge).

## Verificación (V0/V1/V2) — evidencia observada

- V0: `pnpm --filter @granete/ui typecheck` y `pnpm --filter web typecheck`
  limpios.
- V1: suites completas — UI 2199/2199 (nuevos: hub 5 tests, línea 1;
  `appShell.test.ts` actualizado al nav nuevo), web 599/599 (`routes.test.ts`
  +1 caso library; hook #1102 intacto).
- V2: `scripts/organization-browser-gate.sh tests/organization/library-hub-gate.spec.ts`
  → **3/3 PASS** contra stack desechable real (PG + Go + login Chromium real):
  línea contextual en /hardware sin stack ni acciones; link → hub con banner,
  historial abierto por defecto y vista consumidor; modal de publicación abre
  (carga/diff/error honestos) y cancela; /library rebota para admin no
  platform (paridad /platform). Gates API intactos verificados en el mismo
  método: library-publish-gate 3/3, library-consumer-cycle-gate 4/4.
- Visual judge (2 capturas, `artifacts-local/library-hub-gate-*/`):
  superficie pass sin hallazgos; hub pass con observaciones que son datos del
  seed del gate (versión `0.1.0-draft` del seed 000139 + changelog en inglés
  de esa fila) y una deuda preexistente de #1102 Slice D (ver abajo).

## Deuda registrada (no de este slice)

- La Vista consumidor usa un botón sólido (primary del panel) que compite en
  peso con "Publicar" del banner — diseño preexistente de #1102 Slice D;
  candidato a critique en las sesiones #1100 (S24/S25 o el re-pass del hub).
- El seed 000139 deja un release '0.1.0-draft' cuyo nombre/changelog en
  inglés se muestra en el historial — dato del seed, no copy de UI.

## Entrega

Commits en unidades de trabajo (feat web + test organization + docs odd);
PR único con `Closes #1184` + `Delivery: complete` sobre la aceptación
demostrada arriba. Review fresca independiente pendiente; merge es del owner.
Al merge: el owner puede reanudar S17+ del programa #1100 (re-critique verá
el estado nuevo: línea contextual + hub).
