# Milestone evidence: Minimum Authoritative Preflight — GitHub #347

## State

- Issue: #347 — [P0] Implementar manufacturing preflight autoritativo en Muebles
- Milestone: **`minimum authoritative preflight`** (gating #349 y #350)
- Branch: `feat/347-minimum-authoritative-preflight`
- Invariant: **SketchUp owns authoring/interaction; Granete owns manufacturing truth.**
  Cero output fabricable ante ambigüedad crítica o colisiones físicas (status: blocked).

## Entregables del Milestone

1. **`sketchupPreflight.ts`**:
   - `runManufacturingPreflight`: pipeline autoritativo que valida envelope estructural, catálogo, derivación de mecanizado, cotas físicas, límites de panel, profundidad de agujeros y detección de colisiones críticas en la misma cara del tablero.
   - Si hay errores bloqueantes (`hasErrors(issues) === true`):
     - `status: "blocked"`
     - `derivedHardwarePlacements: []` (cero output fabricable)
     - `derivedMachiningOperations: []` (cero output fabricable)
   - Si no hay errores:
     - `status: "ready"` (o `"warning"` si solo hay advertencias)
     - Operaciones y placements derivados listos con su `bomFingerprint` determinístico.

2. **Detección de Colisiones Críticas (`DRILLING_CONFLICT`)**:
   - Algoritmo de proximidad euclidiana sobre todas las perforaciones en la misma cara de cada componente.
   - Detecta colisiones físicas directas entre perforaciones de relaciones constructivas (ej. Minifix/tarugos de entrepaño en Z=350) y herrajes manuales (ej. base/cazoleta de bisagra en Y=350 en el lateral).

3. **Pruebas Automatizadas (`sketchupPreflight.test.ts` - 6 tests)**:
   - [x] Happy path limpio para el fixture de gabinete (`status: "ready"`, `issues: []`, fingerprint FNV-1a).
   - [x] Prueba negativa de colisión crítica: choque bisagra/entrepaño bloquea y produce cero output fabricable (`DRILLING_CONFLICT`).
   - [x] Relación fuera de cotas (entrepaño a Z=850 en panel de 720mm) → `blocked` (`RELATIONSHIP_INVALID`).
   - [x] Profundidad de perforación excediendo grosor de tablero (22mm en tablero de 18mm) → `blocked` (`DRILLING_INVALID`).
   - [x] Componente faltante en catálogo de geometría → `blocked` (`CATALOG_REFERENCE_MISSING`).
   - [x] Ancla con referencia a componente inexistente → `blocked` (`RELATIONSHIP_ORPHANED`).

## Verification Evidence

| Verificación | Comando | Resultado |
|---|---|---|
| Domain Unit Tests | `pnpm --filter @muebles/domain test` | 83 test files, 1079 tests pasando (0 fallos) |
| SketchUp Suite | `pnpm vitest run sketchup` | 3 test files, 40 tests pasando (0 fallos) |
| Workspace Typecheck | `pnpm typecheck` | 7 workspace packages compilando con 0 errores |
| Backend Go Tests | `cd backend-go && go test ./...` | Todos los paquetes Go pasando (0 fallos) |

## Estado de Dependencias Downstream

Con este milestone verificado sobre el fixture de #356, quedan desbloqueadas para implementación:
- **#349** (Parametric library MVP)
- **#350** (Hardware placement/machining sync)

Nota: El issue #347 permanece abierto hasta completar el Definition of Done total (negociación de machine capabilities y machine profiles para #348/#351).
