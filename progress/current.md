# Sesión

**Feature en curso:** F188 — CAMBIO DE MATERIAL: RE-RESOLUCIÓN Y REBUILD
NATIVO ATÓMICO EN SKETCHUP (#404 / MT-3)
**Rama:** `fix/404-material-native-rebuild`
**Inicio:** 2026-08-27
**Contexto:** #402/#403/#414/#415/#434 ya están mergeados. #416 queda
explícitamente fuera de alcance: Groups legacy continúan fallando cerrado.

## Objetivo

Un cambio de material role debe re-resolver el layout completo en Granete y
reconstruir la jerarquía nativa sin perder identidad, placement, bindings ni
el último estado válido ante fallos.

## Plan

1. Fusionar la elección cambiada con `materialChoices` persistidos antes de
   solicitar el nuevo layout; exigir `NativeLayout` para cambios materiales.
2. Aislar cualquier definición top-level compartida antes de reconstruir y
   preservar business identity, Project/Design binding y world transform.
3. Mantener render + metadata dentro de una sola operación SketchUp, con
   rollback completo si resolución o rebuild fallan.
4. Agregar pruebas de propagación BODY/FRONT/agregados/herrajes, definición
   compartida, round-trip de metadata, failure safety y Groups fail-closed.
5. Ejecutar gates focalizados, `rake verify`, `./init.sh`, revisión y push.

## Estado

- Autoridades e issue #404 leídas.
- Implementaciones #402/#403/#414/#415/#434 revisadas; no se duplicará lógica
  física Go/TS ya mergeada.
- Implementación completa, pendiente de revisión automática.

## Implementación

- `FurnitureBridge` fusiona la elección entrante con los roles persistidos antes
  de pedir el layout completo nuevo.
- `FurnitureBuilder` exige `NativeLayout` cuando cambia la intención material,
  aísla con `make_unique` una definición top-level compartida antes de `clear!`,
  regenera children/herrajes desde el contrato #414 y escribe metadata al final.
- El writer preserva business identity y contexto Project/Design, avanza
  `sourceRevisionRef` y conserva roles no modificados.
- El stub SketchUp modela copy-on-write, nombres de definition únicos y rollback
  de attributes para demostrar atomicidad real del contrato.
- #416 no se tocó: Group legacy continúa fallando cerrado.

## Evidencia

- `material_rebuild_test.rb`: 5 tests / 53 assertions — FRONT 16→18 en puerta
  + frentes de cajón, BODY 16→18 en todas sus piezas, BACK/roles aislados,
  posiciones y herraje recalculados, identity/world transform preservados,
  definición compartida aislada, nil layout fail-closed y rollback completo.
- `dialog_controller_test.rb`: 19 tests / 95 assertions — request fresco con
  `materialChoices` fusionados y fallo de resolución antes del builder.
- `bundle exec rake unit boundary`: 162 tests / 1477 assertions + 3 tests /
  801 assertions, 0 fallos.
- `bundle exec rake verify`: syntax + RuboCop + unit + boundary + RBZ
  determinístico, verde; SHA-256 `14a50b8397d183f9d342f41395981022ef7a4b49a12002ec27f3adb7dc9d7de8`
  antes del último refuerzo de fixture; unit/boundary focalizados se repitieron
  después y quedaron verdes.
- `./init.sh` con Ruby 3.2.11, Go cache writable y acceso registry: exit 0;
  `pnpm typecheck`, 3219 tests TS, Go completo y gate Ruby/RBZ verdes.
