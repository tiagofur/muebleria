# F098 — Instalaciones: dirección y contacto del cliente

## Estado

Implementación lista para revisión. `feature_list.json` permanece en
`in_progress` hasta el veredicto del reviewer.

## Alcance realizado

- La card de Instalaciones deriva nombre, dirección, teléfono y email del
  `Customer` existente asociado a cada obra.
- La dirección aparece con `MapPin`; teléfono y email son enlaces `tel:` y
  `mailto:` con iconos Lucide.
- Si no existe el cliente o faltan campos, la card omite esos datos: no se
  fabrican placeholders ni valores de contacto.
- El bloque usa marcado semántico `address`, etiqueta accesible y estilos BEM
  basados únicamente en tokens. En phone apila los detalles para conservar
  legibilidad y targets utilizables.

## Archivos modificados

- `packages/ui/src/production/InstalacionesScreen.tsx`
- `packages/ui/src/production/InstalacionesScreen.test.tsx`
- `packages/ui/src/production/production.css`
- `apps/web/src/App.tsx`
- `feature_list.json`
- `progress/current.md`

## Tests añadidos

- Derivación de datos completos y parciales del `Customer`.
- Render de dirección, enlace telefónico y enlace de email.
- Ausencia segura de datos de contacto cuando no se encuentra el cliente.

## Verificación

- `pnpm --filter @muebles/ui test -- InstalacionesScreen.test.tsx` — verde (8 tests del archivo).
- `pnpm typecheck` — verde.
- `pnpm test` — verde.
- `./init.sh` — verde.
- `git diff --check` — verde.

Notas: la suite existente emite advertencias conocidas de jsdom/WebGL y
múltiples instancias de Three.js; no producen fallos.

## Correcciones solicitadas en revisión

- Se añadió `overflow-wrap: anywhere` al texto de cada detalle de cliente,
  junto con `min-width: 0`, para que email y dirección extensos puedan quebrar
  dentro de la card en phone sin truncarse ni desbordar.
- Se agregó un test de render de una card con contacto parcial y email largo:
  verifica el enlace `mailto:`, el bloque semántico `address`, su etiqueta
  accesible y el uso de la clase que habilita el wrapping.

### Verificación posterior a corrección

- `pnpm --filter @muebles/ui test -- InstalacionesScreen.test.tsx` — verde (9 tests del archivo; 963 UI totales).
- `pnpm typecheck` — verde.
- `pnpm test` — verde.
- `./init.sh` — verde.
- `git diff --check` — verde.

## Entrega

- Commit funcional: `06df328 feat(production): show customer contacts for installations`.
- Estado de F098: `done` tras aprobación en `progress/review_f098.md`.
- Push: confirmado a `origin/codex/f095-production-claims` (HEAD `56b721a`).
