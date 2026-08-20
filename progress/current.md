# Sesión activa

**Feature:** F127 — Perfiles de maquinado en catálogo de herrajes (perforaciones CNC — 1/5)
**Estado:** in_progress
**Inicio:** 2026-08-20

## Contexto de la serie

Re-escpeo de F081 decidido con el dueño del producto (2026-08-20): perforaciones
CNC driven-by-herraje como **datos estructurados** (sin CSG visual), export DXF por
capas como primer objetivo (importable en SCM Maestro con asignación capa→herramienta),
post-procesador nativo SCM postergado (F132). Decisiones cerradas:

1. **DXF primero**, script SCM (.xcs/MSL) después como exporter delgado.
2. **Sistema 32mm** como filosofía de defaults (línea de sistema 37mm, parametrizable).
3. **Coordenadas desde cantos** por cara vista desde afuera; espejado de caras
   traseras lo resuelve el export, no el usuario.
4. **Reglas automáticas + edición manual de excepciones** (maximiza precisión,
   minimiza errores).

Serie: F127 catálogo → F128 motor → F129 reglas de unión → F130 export DXF →
F131 editor visual → F132 SCM nativo (postergado).

## Plan F127

- Tipos `MachiningOperation` / `HardwareMachiningPart` / `HardwareMachiningProfile`
  en `packages/domain` + `Hardware.machining?` opcional (retrocompatible).
- `validateMachiningProfile` con `ValidationError` accionable.
- Seeds demo paridad TS/Go: taquete 8×30, minifix (cazuela+perno), bisagra
  (taza+2 fijaciones) + placa base (32mm), tornillo (piloto).
- Sección «Maquinado» en detalle de herraje del catálogo (tokens design.md).
- Persistencia: apiMappers + struct Go + migración aditiva JSONB.
- Tests: validación, seeds golden, round-trip mappers, render editor.

## Bitácora

- 2026-08-20: gate `./init.sh` verde (sesión PTX previa cerrada en `c43f144`, pushed).
  Backlog re-escpeado (F081 → done por re-scopeo; F127–F132 agregadas; F127 in_progress).
- 2026-08-20: implementación F127 completa:
  - **Dominio**: `MachiningOperation` / `HardwareMachiningPart` / `HardwareMachiningProfile`
    en `types.ts` + `Hardware.machining?`; `hardwareMachining.ts` con
    `validateMachiningProfile` (ValidationError accionable), `normalizeMachiningProfile`
    (sanitización leniente para ingest), `countMachiningOperations`.
  - **Seeds paridad**: bisagra (taza Ø35×12.5 + 2 fijaciones Ø5 a 45mm), placa base
    (2×Ø5 a 32mm — sistema 32), taquete 8×30 (ciego Ø8×15 por lado), minifix juego
    (cazuela Ø15×13 + piloto perno Ø5×12), tornillo 4×50 (piloto Ø3×35) en
    `plantillaDemo.ts` (3 items nuevos: HER-TAQ-8X30, HER-MIN-15, HER-PLACA-BIS) y
    `seed.go` (UUIDs a0000003-…-0010/11/12, valores espejo).
  - **UI**: `HardwareMachiningSection.tsx` (disclosure «Maquinado CNC» en el modal,
    auto-open al editar herraje con perfil — patrón F117), draft estructurado,
    validación en submit vía dominio, resumen en detalle expandido, CSS con tokens
    en `catalogs.css`.
  - **Persistencia**: apiMappers TS (normaliza en ingest, null en legacy), store web
    (create/update + drop), Go struct + scan/insert/update con JSONB, migración
    aditiva `000063_hardware_machining` (embed automático).
  - **Tests**: domain 688 (+22: validación/normalize/golden seeds), storage 129
    (+3: round-trip API), ui 1134 (+5: editor render/add/validación/quitar/resumen),
    web 288 (+2: store preserva perfil), Go `TestHardware_PersistsMachiningProfile`
    (integración real contra Postgres local: nil/clear/dos partes con profundidades).
  - `pnpm test` (2376 total), `pnpm typecheck` (7 workspaces) y `go test ./internal/...` verdes.
  - Nota DoD UI (§8 design.md): screenshot review no aplica — la sección vive dentro
    del modal existente con clases `catalog-form__*` ya especificadas; sin pantalla nueva.
