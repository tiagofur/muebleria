# Explore #108 — Tests y convenciones aplicables

> Generado por subagente explorer (read-only), volcado por el leader.

## 1. Tests existentes relevantes

**Domain TS** (viven junto al fuente, NO hay `__tests__/`):
- `packages/domain/src/engine.test.ts:900` — `F049: validateStructure accepts cuerpo with component instances`
- `:913` — `F049: validateStructure rejects empty components and bad quantity`
- `:1778` — `describe('evaluatePartFormula & resolveStructure (F050 / H05)')`
- `:1833` — `describe('resolveStructure')` (sin board parts propios post-F053, presets opcionales, validación dims > 0)
- `:144,148,177,226,230,243` — fixtures con `structures:[...]` y `structureId`
- `packages/domain/src/duplicate.test.ts:7,17,52,76,126,144,184` — import `QuotePriceSnapshot`, chequea `priceSnapshot: snapshot`, `structuredClone` "original unchanged", preservación `structureId`
- `packages/domain/src/types.test.ts:181,187,209,229` — Project con/sin `QuotePriceSnapshot`, `schemaVersion: 1`
- `packages/domain/src/scenarioCompare.test.ts` — `priceSnapshot: undefined` en escenarios

**Backend Go:**
- `backend-go/internal/domain/engine/resolve_composed_test.go:77-90` — fixture `domain.Structure` + `StructureID: "st-1"`
- `backend-go/internal/domain/engine/validate_test.go:183` — solo valida edges (NO tests de versionado)

**Ausencias clave:** NO existe test de "versionado de estructuras" ni snapshots de estructura/componente. `Structure` no tiene `version`/`snapshot`/`revision` ni TS ni Go.

## 2. Convenciones aplicables (conventions.md)

- Inmutabilidad: *"Las entidades del dominio son `readonly`"*, *"Modificar = crear nuevo objeto con spread. No mutar en lugar."* (`conventions.md:102-124`). `Structure` ya es `readonly`.
- Naming: interfaces `PascalCase`, funciones `camelCase`, constantes `UPPER_SNAKE`. IDs UUID v4 string; `code` legible para negocio.
- Tests Vitest: *"Un `describe` por función/unidad lógica"*, fixtures en `src/__fixtures__/`, golden tests contra JSON.
- Errores: `DomainError`/`ValidationError`/`ResolutionError` con `context`; UI captura y muestra `message`.
- Comentarios: solo explican por qué no obvio.

## 3. Restricciones de boundary (architecture.md)

`architecture.md:58-66` tabla no negociable:

| Paquete | Puede importar | No puede importar |
|---|---|---|
| `domain` | solo stdlib TS | react, electron, fs, xlsx |
| `storage` | fs (Node), domain types | react, electron, xlsx |

Principio rector: *"Dominio primero. Los cálculos (BOM, costos, validaciones) viven en `packages/domain`. Es puro TypeScript, 100% testeable con Vitest sin DOM."* (`architecture.md:8-12`).

Paridad cliente-servidor: fórmulas y cálculo replicados en Go (`architecture.md:92-95`).

**Implicación para #108:** la lógica de versionado DEBE vivir en `packages/domain` (TS puro) y replicarse en `backend-go/internal/domain`. Storage solo persiste; apps/ui no calculan. Precedente de patrón snapshot: `captureQuoteSnapshot` + `QuotePriceSnapshot` (`engine.ts:1288`, `types.ts:515`); `schemaVersion` Workspace (`types.ts:453`, `SCHEMA_VERSION = 2` en `packages/storage/src/seed.ts:14`).

## 4. PRD — menciones relevantes

- *"Auditable. Toda cifra de cotización debe poder rastrearse a fórmula + datos de entrada."* (`prd.md:75`)
- Política snapshot: *"Precios nuevos sin romper proyectos viejos (política de snapshot, ver §10)"* (`prd.md:97`)
- *"En proyecto, las instancias conservan referencia a `moduleId` + índice/id de ítem para poder re-exportar y auditar."* (`prd.md:474`)
- NFR-10: *"Versionado de archivo — Formato de persistencia versionado (`schemaVersion`) para migraciones"* (`prd.md:656`)
- NO hay mención explícita a "versionado de estructuras" en el PRD (pertenece a app-excellence/icebox).

## 5. Plan de excellence sobre #108 (app-excellence.md)

- Apariciones: `:71` (Icebox horizonte), `:109` (capa Ingeniería, **P2**), `:320` (resumen).
- *"El horizonte H01–H12 está cerrado; el WIP actual refina paneles + 3D + color de material."* (`:76`)
- GitHub `#112 META, #108–#111 icebox` (`:320`).
- No bloquea el WIP actual. Modelo estructuras + componentes ya existe (F049/F053 ✅ `:106`); #108 es el siguiente paso (versionar esos cuerpos reutilizables).

## Resumen ejecutivo

- **No hay tests previos** de versionado. Tests base a extender: `engine.test.ts`, `duplicate.test.ts`, `types.test.ts`.
- **Modelo sin versión:** `Structure` (`types.ts:215-228`, `types.go:209-222`) carece de campos. Habrá que añadirlos `readonly` + espejo en Go.
- **Patrón a seguir:** `QuotePriceSnapshot` + `captureQuoteSnapshot` + `schemaVersion`. Análogo: pin de revisión de estructura en `ProjectItem`/`Module`.
- **Boundary:** `packages/domain` (TS) + `backend-go/internal/domain/engine`. Storage persiste; UI no calcula.
- **Prioridad producto:** P2, icebox. No bloquea WIP.
