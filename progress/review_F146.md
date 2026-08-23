# Review — feature F146

**Veredicto:** APPROVED

**Feature:** proyectar_design_bom_price_contracts (#313 P3D-7, meta #308)
**Rama:** `feat/f145-contracts-p3d7` (apilada sobre `feat/f144-precision-dims`, PRs #331/#332 abiertos)
**SDD:** https://github.com/tiagofur/muebleria/issues/313#issuecomment-5383259129

## Checkpoints

- C1: [x] Harness completo; `go test ./...` 8 paquetes ok; `pnpm test` 2.924 tests;
  `pnpm typecheck` 0 errores.
- C2: [x] Una feature en curso; tests asociados pasan; current.md describe la sesión.
- C3: [x] Boundaries: dominio Go sin dependencias nuevas; storage sólo persistencia;
  errores Go como `error` con mensaje en español (patrón del engine); sin lógica de
  negocio nueva en UI (el gate lo prohíbe hacia adelante).
- C4: [x] Verificación real: contract TS 6/6 + contract Go 4/4 sobre EL MISMO fixture
  (paridad numérica exacta: piezas, materiales, hardwareTotals, costos tol 0.01);
  round-trip storage contra Postgres real (create → update → clear); unit Go 4/4.
- C5: [x] Sin archivos sospechosos; ledger done; current.md/history cierre.

## Contratos (DoD del issue #313)

- Fixture cubre: preset ✓ · cambio dimensión (customDims) ✓ · cambio material ✓ ·
  agregado qty ✓ · fingerprint stale (TS; O1/#300 documentado en el fixture) ✓ ·
  anti-leak ambiental ✓ (ids ausentes de BOM en ambas suites; guard
  `ambientLeakGuard.test.ts` existente como evidencia adicional).
- Determinista: expected congelados en el repo; la regla "se alinea el motor, nunca
  el expected" está en el fixture y en ambas suites.
- React no duplica: `domainBoundaryGuard.test.ts` (2 tests) prohíbe aritmética de
  costo/merma/fórmulas paramétricas en packages/ui, con allowlist de deuda
  preexistente (purchasing) que se valida vigente.
- Paridad TS/Go de la regla que vive en ambos (resolveBom + breakdown): congelada.

## Hallazgos encontrados y CORREGIDOS durante la review

1. **Colisión de migración 000077**: la DB local ya tenía 77 de la rama
   `feat/f142-materials-dock` → mi migración se saltaba silenciosamente
   (schema_migrations marca 77 aplicada). Renumerada a **000078** tras verificar
   todas las ramas vivas. El test de storage lo detectó (columna inexistente).
2. **Aliasing de slices en test Go** (`custom := base` comparte backing array de
   Items): el override mutaba también la base. Corregido con copia explícita.
3. **Gate UI demasiado amplio**: `evaluatePartFormula` marcaba a ComponentsScreen
   que IMPORTA de domain (patrón correcto). Patrón refinado a implementaciones
   locales; el allowlist documenta la deuda purchasing (Fase 3c) que el gate
   detectó — perteneciente a Procurement/Inventory, registrada, no tocada aquí.

## Notas de alcance (deuda explícita, no bloqueantes)

- Fórmulas paramétricas DENTRO de agregados: TS resuelve contra el sub-espacio del
  agregado, Go contra las dims del padre — divergencia conocida documentada en el
  fixture (el componente del agregado usa geometría fija a propósito). Alinearla es
  follow-up de #312/#313; el contract la deja explícita en vez de esconderla.
- stale→approval→nuevo ProductionRelease completo: espera O1/#300 (fingerprint ya
  congelado, ambos lados).
- Deuda purchasing (valor de inventario en UI): allowlist del gate + registrada.

---

# Review — recuperación F142 + F146 (incidente de stacking, 2026-08-23)

**Veredicto:** APPROVED

**Contexto:** PR #333 (contracts #313) y PR #330 (F142 #309) se mergearon por
error a sus RAMAS BASE (`feat/f144-precision-dims` y `feat/f141-proyectar-library`
respectivamente) después de que éstas ya habían ido a main → el trabajo quedó
huérfano y main nunca lo recibió. Esta sesión recupera ambos sobre main.

- R1: [x] **Completitud F142**: cherry-pick de `5617311..e530c0c` (4 commits).
  Archivos propios idénticos a la rama huérfana (BoardMaterialPalette,
  paintMaterial, cascadeLevels, materialCategories Go ×3, migración 000077,
  en-desarrollo.md) — diff vacío verificado.
- R2: [x] **Completitud F146**: cherry-pick de b1e5c68; archivos idénticos salvo
  renumeración F145→F146 (colisión con #311 environment_multispace, F145 en el
  ledger de main) — diff vacío tras `sed s/F145/F146/g` verificado.
- R3: [x] **Conflictos resueltos conservando la evolución de main**: import union
  en studio; `moduleSelected={selectedKeySet.has(key) || boardPaintHover}`
  (multiselección F143 + hover de pintura F142); props/botones mock unificados en
  el test; bloque describe F142 re-agregado al final. Un conflicto semántico
  corregido: `setSelectedKey` (eliminado por F143) → `setSelection({keys,anchor})`
  patrón actual — commit propio documentado.
- R4: [x] **Sin residue**: 0 markers de conflicto en el repo (grep ts/tsx/go/
  json/css/md).
- R5: [x] **Ledger**: JSON válido, sin ids duplicados, F142 única (la entrada
  restaurada en b34c8d8 se conserva), F146 agregada con nota de recuperación.
- R6: [x] **Harness**: `go vet` limpio; `go test -count=1 ./...` 8 paquetes OK
  (storage contra Postgres real, migraciones 000077+000078 aplicadas);
  `pnpm test` 2.982 tests OK (domain 1.031 · ui 1.344 con dock F142 + guard);
  `pnpm typecheck` OK. Contract TS 6/6 + guard 2/2 + contract Go 4 escenarios
  + 3 unitarios verdes tras la renumeración.
- R7: [x] **Trabajo pusheado**: ambas ramas en origin antes de este veredicto.
- R8: [x] El review APPROVED original del trabajo (sección superior) aplica al
  contenido recuperado tal cual; esta sección cubre sólo la recuperación.

**Lección del incidente (para el proceso de PRs apiladas):** al cerrar un PR
apilado, verificar `baseRefName` antes de mergear — si la base ya se mergeó a
main, re-apuntar el PR a main. #330 y #333 se cerraron "verdes" en GitHub sin
tocar main.
