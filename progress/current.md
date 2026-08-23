# Sesión

**Feature cerrada:** F145 — proyectar_environment_multispace (#311 P3D-4, meta #308 etapa E5)
**Inicio:** 2026-08-23 · **Cierre:** 2026-08-23
**Subplan (SDD):** https://github.com/tiagofur/muebleria/issues/311#issuecomment-5384066402

## Resultado

Environment authoring + multi-ambiente 5★ (North Star §§13–14). **Muros editables
dentro del studio**: tarjetas por muro en el inspector Ambiente (nombre, largo mm,
ángulo con chips 0/90/180/270 + numérico, origen avanzado colapsado) que commitean
en blur/Enter como UNA intención (`CommitOnBlurInput`, bar F144 §12); Agregar muro
encadena desde el último extremo girando +90° (rectángulos cierran solos); Quitar
muro descoloca sus muebles con mensaje que enseña el conteo (política de ownership:
un placement nunca sobrevive a su muro). **Huecos** (`WallOpening`
ventana/puerta/pasaje, presentation-only — jamás en BOM) en `KitchenWall` con
comandos puros `kitchenEnvironmentCommands.ts`: alta rápida en el primer tramo
libre con defaults por tipo, edición/baja, `ValidationError` que enseña (hueco
fuera del muro, solape, altura > muro, acortar muro bajo hueco) y warnings de
mueble tapando hueco. `splitWallSegments` (geometría pura) parte el muro en boxes
sólidos alrededor de huecos → **3D con huecos reales sin CSG** (WallMesh y
WallAmbientMesh por segmentos + vidrio translúcido en ventanas) y planta 2D con
vanos punteados y tooltip. **Fit room** (botón Ajustar) encuadra muros+muebles con
la cámara `fit-selection` de F144. **Ocultar muros**: atenúa (fantasma 0.12) los
muros entre cámara y ambiente (`wallsOccludingCamera` puro; tracker con guard por
CONTENIDO del conjunto — la órbita no re-renderiza; default off). **Cámara por
ambiente**: el switch re-encuadra con la vista recordada del espacio destino
(default 3/4) — nunca hereda el encuadre anterior. Storage: `openings` snake_case
en `apiMappers` con round-trip test (backend guarda blob JSON, sin cambios Go).
Incidente de ledger detectado y reparado: el commit F143 (21ae7b4) pisó
`feature_list.json` desde una copia stale y borró la entrada F142 (mergeada en
PR #330); se restauró la entrada original desde git 1076997.

## Verificación (evidencia)

- `pnpm test` exit 0 — 2.952 tests (domain 1.022 · storage 154 · excel 89 ·
  ui 1.324 · mobile 45 · desktop 17 · web 301); `pnpm typecheck` exit 0.
- Smoke WebGL Playwright 4/4 (F145: abrir muro → ventana con defaults → tarjeta
  informa hueco → Ajustar + Ocultar muros → crear Espacio 2 → muro sólo ahí →
  volver a Cocina sin mezcla; screenshot `test-results/proyectar-multispace.png`
  revisado).
- Review: **APPROVED** con 3 hallazgos aplicados durante la revisión (guard de
  performance del auto-hide por contenido del set, commits de campos en
  blur/Enter, fallback de radius inventado) — `progress/review_F145.md`.

## Siguiente etapa

#313 (P3D-7) — contract tests diseño→BOM→precio→producción (pospuesto por
decisión del usuario al ejecutar #311 primero; el freeze del `dimsOverride`
sigue pendiente). Después #312 (P3D-6) performance → #314 (P3D-8) benchmark.
