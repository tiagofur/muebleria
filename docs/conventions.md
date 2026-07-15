# Convenciones de código

> Homogeneidad extrema. El agente predice mejor cuando el repositorio
> se parece a sí mismo en todas partes.

## Stack y versiones

- **Lenguaje:** TypeScript 5.x, `strict: true`, ESM modules.
- **Runtime:** Node.js ≥ 20. No usar APIs < Node 20.
- **Tests:** Vitest. Un archivo `*.test.ts` por módulo.
- **Formato:** Prettier con config por defecto (2 espacios, comillas simples).
- **Linting:** ESLint con `@typescript-eslint` — no `any` sin justificación.

## Nombres

| Tipo | Convención | Ejemplo |
|------|-----------|---------|
| Archivos de módulo | `camelCase.ts` | `optimizerExport.ts` |
| Interfaces / tipos | `PascalCase` | `MaterialBoard`, `ResolvedBom` |
| Funciones | `camelCase` | `resolveBom`, `calcLineCost` |
| Variables | `camelCase` | `totalCost`, `boardPart` |
| Constantes | `UPPER_SNAKE` | `SCHEMA_VERSION`, `DEFAULT_MARGIN` |
| Privadas/internas | prefijo `_` | `_atomicWrite` |
| IDs de entidad | UUID v4 (string) como ID primario; 'code' legible para negocio | id: `"123e4567-e89b-12d3-a456-426614174000"`, code: `"MOD-GAB-01"` |

## Estructura de archivo

Cada módulo en `packages/*/src/` empieza con:

```typescript
/**
 * Una línea describiendo el propósito del módulo.
 */

// imports de terceros primero
import { WorkBook } from "xlsx";

// imports locales
import type { ProductionCutRow } from "../types";
```

## Tests (Vitest)

```typescript
import { describe, it, expect } from "vitest";

describe("resolveBom", () => {
  it("asigna material correcto según optionRole", () => {
    // arrange
    const module = buildModuleFixture();
    const choices = { INTERIOR: "mat-blanco" };
    // act
    const bom = resolveBom(module, choices, catalog);
    // assert
    expect(bom.boardParts[0].materialId).toBe("mat-blanco");
  });

  it("lanza ResolutionError si falta choice en grupo required", () => {
    expect(() => resolveBom(module, {}, catalog)).toThrow(ResolutionError);
  });
});
```

Reglas:
- Un `describe` por función / unidad lógica.
- Usa fixtures en `src/__fixtures__/` — no construyas datos inline complejos.
- Tests de storage: usa `tmp` real de Node (`fs.mkdtempSync`), no mocks de fs.
- Golden tests del export: compara contra fixture JSON en `src/__fixtures__/`.

## Tipos: inmutabilidad

Las entidades del dominio son `readonly`:

```typescript
interface BoardPart {
  readonly id: string; // UUID v4
  readonly optionRole: string;
  readonly lengthMm: number;
  // ...
}

interface Module {
  readonly id: string; // UUID v4
  readonly code: string; // Único legible, ej. "MOD-GAB-01"
  readonly name: string;
  readonly baseLaborCost?: number; // Opcional, costo mano de obra base
  readonly boardParts: readonly BoardPart[];
  // ...
}
```

Modificar = crear nuevo objeto con spread. No mutar en lugar.

## Manejo de errores

```typescript
// dominio — lanza; la UI captura
export class DomainError extends Error { ... }
export class ValidationError extends DomainError { ... }
export class ResolutionError extends DomainError { ... }

// funciones que devuelven resultado opcional
function findMaterial(id: string, catalog: Catalog): MaterialBoard {
  const m = catalog.materials.find(x => x.id === id);
  if (!m) throw new ResolutionError(`Material no encontrado: ${id}`, { materialId: id });
  return m;
}
```

La UI captura `DomainError` y muestra `error.message` + contexto localizado en español.
Nunca propaga stack traces al usuario.

## Comentarios

Por defecto **no** se escriben. Solo cuando explican un *por qué* no obvio
(workaround documentado, invariante sutil, decisión de producto no evidente).
Los nombres hacen el resto.

## IDs y trazabilidad

- Módulos: `code` único legible (`MOD-GAB-01`). Generado por el usuario.
- Piezas de tablero: `{moduleCode}-P{index:02d}` (ej. `MOD-GAB-01-P01`).
- Líneas de herraje: `{moduleCode}-H{index:02d}`.
- UUIDs internos para entidades que no tienen `code` externo.
