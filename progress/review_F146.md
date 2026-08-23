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
