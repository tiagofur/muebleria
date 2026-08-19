# Review — feature F098

**Veredicto:** APPROVED

## Alcance revisado

F098 expone en cada card de Instalaciones los datos existentes del `Customer`:
dirección, teléfono y email. No fabrica valores para clientes inexistentes o
campos ausentes. Teléfono y email son enlaces accionables (`tel:` y `mailto:`),
y la información se presenta dentro de `address` con etiqueta accesible.

La corrección solicitada en la primera revisión está resuelta: el texto de cada
detalle tiene `min-width: 0` y `overflow-wrap: anywhere`, por lo que una
dirección o email sin puntos de corte no desborda la card en phone. El caso de
contacto parcial con email largo protege el markup final y su semántica.

## Checkpoints

- C1: [x] Harness presente; `./init.sh` terminó con exit code 0.
- C2: [x] F098 es la única feature en `in_progress` y `progress/current.md` describe el trabajo activo.
- C3: [x] Respeta los boundaries: `packages/ui` sólo consume `Customer` de `@muebles/domain`; no calcula dominio ni accede a infraestructura.
- C4: [x] Verificación fresca verde: 963 tests de UI, `pnpm typecheck`, `pnpm test`, `./init.sh` y `git diff --check`.
- C5: [x] El estado está documentado y no hay commits locales pendientes de push (`origin/codex/f095-production-claims..HEAD` vacío). El cierre/commit de F098 queda para el flujo posterior de entrega.

## Diseño UI/UX

- D1: [x] Los estilos nuevos usan exclusivamente tokens del design system.
- D2: [x] Conserva el patrón `ship-board` de Instalaciones, con HTML semántico y enlaces reales.
- D3: [x] No introduce modal.
- D4: [x] No introduce toast.
- D5: [x] Los iconos nuevos son Lucide y usan `strokeWidth={1.5}`.
- D6: [x] La transición nueva está limitada por `prefers-reduced-motion: no-preference`.
- D7: [x] Phone seguro para dirección/email extensos: wrapping explícito sin truncar datos operativos.

## Evidencia

- `pnpm --filter @muebles/ui test -- InstalacionesScreen.test.tsx` — exit 0 (incluye 9 tests de `InstalacionesScreen`).
- `pnpm typecheck` — exit 0.
- `pnpm test` — exit 0.
- `./init.sh` — exit 0.
- `git diff --check` — exit 0.
