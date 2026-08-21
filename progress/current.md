# Sesión activa

**Feature:** F128 — Motor de resolución: placements + perfiles → agujeros por pieza (perforaciones CNC — 2/5)
**Estado:** done (sesión cerrada, revisada y pusheada — 3 rondas de review)
**Inicio:** 2026-08-20 (noche)

## Plan

1. Estudiar flujo: `ResolvedBoardPart` (campos, link a componentInstanceId),
   `HardwarePlacement` (frame por cara), consumidores de `HoleDefinition`.
2. Motor puro en `packages/domain` (`partDrillingResolver.ts`):
   `resolvePartDrilling({ piece, placements, hardware })` → holes reales por cara
   (coords desde cantos, mismo face-plane que placements) + issues estructuradas
   (profundidad vs dimensión de entrada, fuera de pieza, colisiones) + dedupe.
3. `assertDrillingValid` que lanza `ValidationError` accionable con contexto.
4. Fallback a heurísticas F074 cuando no salen holes de placements/perfiles
   (deprecación gradual, exports intactos — el rewiring es F130).
5. Tests: golden bisagra sobre puerta, minifix cazuela+perno en dos piezas,
   mover placement mueve holes, cambiar herraje adapta Ø/prof, validaciones,
   dedupe, fallback.

## Bitácora

- 2026-08-20: F127 done + review APPROVED. Post-cierre por feedback del taller:
  F133 (default de corte del taller) done; selector unificado con Ajustes (`19f467a`);
  visor strategy-aware sin líneas guillotina en nesting (`1dbccd1`).
- 2026-08-20 (noche): F128 implementada y verificada:
  - `packages/domain/src/partDrillingResolver.ts`: motor puro de resolución de perforaciones CNC a partir de `HardwarePlacement` y `HardwareMachiningProfile`. Coordenadas por cara referenciadas a cantos, evaluación de fórmulas paramétricas (`W`, `L`, `T`, `HW`, etc.), rotación en plano (`rotationDeg.z`), cara opuesta (`face: 'opposite'`), profundidad de pasantes (`through_hole`).
  - Deduplicación de agujeros coincidentes generados desde distintos placements (`deduplicateHoles`).
  - Validaciones geométricas estructuradas (`validateDrillingHoles`): `DEPTH_EXCEEDS_MATERIAL`, `HOLE_OUT_OF_BOUNDS`, `HOLE_COLLISION` (en la misma cara y por penetración interna en caras opuestas) + `assertDrillingValid` que lanza `ValidationError`.
  - Fallback a heurísticas F074 (`inferHolesForPiece`) cuando no existen perfiles de maquinado o placements (`fallbackUsed: true`).
  - `partRole` opcional en `HardwarePlacement` y `cloneHardwarePlacement` para herrajes multipartes (ej. `cam` vs `bolt` en minifix).
  - 18 tests en `partDrillingResolver.test.ts` (golden bisagra 35mm, golden minifix 15mm en unión costado-piso, reactividad al mover placement o cambiar herraje, rotación 90°, fórmulas paramétricas, deduplicación, validaciones y fallback).
  - `pnpm test` (710 tests en domain, todos verdes), `pnpm typecheck` verde y `./init.sh` verde.

## Contexto previo (sesiones de hoy)

- F127 cerrada: herrajes con perfil de maquinado en catálogo (TS/Go paridad,
  seeds 4 básicos, migración 000063). Review APPROVED (`progress/review_F127.md`).
- F133 cerrada: defaultCutStrategy (precedencia plan obra → taller → sierra).
  Incidente de split de commits documentado en history.md (F133).
- Deuda anotada: paridad Go de settings PTX; `btn--secondary` del panel.


## Cierre (2026-08-21)

- F128 implementada por sesión paralela (`cb21e4a`); esta sesión hizo la revisión
  (RECHAZADA→APPROVED en 3 rondas) y los fixes: `4dd56ab` (heurística face-planes,
  contrato ejes DXF, copy) y `7fed3e9` (colisión caras opuestas con separación real).
- Suite 2422, typecheck 7/7, domain 716 (24 en el resolver), HEAD == origin `7fed3e9`.

## Siguiente

F129 — reglas de unión paramétricas sistema 32 (minifix/taquetes/bisagras como
placements derivados que F128 resuelve). F130 tomará el wiring DXF ya adelantado.
