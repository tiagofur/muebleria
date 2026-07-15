# Verificación — Cómo demostrar que el trabajo funciona

> Regla de oro: **el agente no dice "funciona", lo demuestra**.
> Toda feature termina con evidencia ejecutable, no con afirmaciones.

## Niveles de verificación

### Nivel 1 — Tests unitarios del dominio (obligatorio siempre)

```bash
pnpm --filter @muebles/domain test
```

Cubre: tipos, resolución de BOM, cálculos de costo, validaciones.
Sin DOM, sin React, sin Electron.

### Nivel 2 — Tests de paquetes específicos (obligatorio según feature)

```bash
pnpm --filter @muebles/excel test    # export Optimizer
pnpm --filter @muebles/storage test  # persistencia JSON
pnpm --filter @muebles/ui test       # componentes (si hay tests de componente)
```

### Nivel 3 — Test de todos los paquetes (obligatorio antes de `done`)

```bash
pnpm test     # corre Vitest en todos los workspaces
```

Equivale a `./init.sh` cuando el monorepo existe.

### Nivel 4 — Golden test del export (obligatorio para F003, F004, F011)

Cargar fixture de `MOD-GAB-01` + `MOD-CAJ-01` con opciones de la plantilla
Excel y comparar los totales contra los valores de referencia:

```typescript
import { describe, it, expect } from "vitest";
import { GOLDEN_FIXTURE } from "./__fixtures__/plantillaDemo";
import { calcProjectBreakdown } from "../engine";

it("golden: proyecto demo iguala totales de Plantilla_Muebles.xlsx", () => {
  const breakdown = calcProjectBreakdown(GOLDEN_FIXTURE.project, ...);
  expect(breakdown.directCost).toBeCloseTo(GOLDEN_FIXTURE.expected.directCost, 2);
  // Verificación de mano de obra mixta (modular + fija por proyecto)
  expect(breakdown.laborModular).toBe(GOLDEN_FIXTURE.expected.laborModular);
  expect(breakdown.salePrice).toBeCloseTo(GOLDEN_FIXTURE.expected.salePrice, 2);
});
```

Cualquier divergencia intencional (ej. merma) debe documentarse en el test.

### Nivel 4b — Pruebas de almacenamiento e integridad (obligatorio para F002, F005)

- **UUIDs e Integridad:** Los tests de `storage` y `engine` deben validar que la carga y guardado de proyectos preserva las relaciones lógicas mediante UUIDs válidos (e.g. que `ProjectItem.moduleId` apunte al `Module.id` del catálogo).
- **Mano de obra modular:** Validar unitariamente que si un `Module` tiene `baseLaborCost` indefinido o nulo, el motor asume `0` y no lanza excepciones.

### Nivel 5 — Smoke test del export (obligatorio para F004, F010)

```bash
node packages/excel/src/__fixtures__/smokeExport.mjs
# → genera /tmp/optimizer_smoke.xlsx
# → abre en LibreOffice/Excel y verifica visualmente columnas A-J
```

## Anti-patrones (no hacer)

- ❌ "He implementado la función, debería funcionar." → falta evidencia ejecutable.
- ❌ Test que solo verifica que no lanza excepción → debe comprobar el valor concreto.
- ❌ Mock del filesystem → usa `fs.mkdtempSync` real.
- ❌ Marcar feature `done` sin `pnpm test` verde.
- ❌ Golden test que ignora divergencias → documenta o corrige.

## Verificación final antes de cerrar

```bash
./init.sh
```

Salida esperada: `[OK] Entorno listo. Puedes empezar a trabajar.`

Si `./init.sh` está rojo, **no** marques nada como `done`.
Anota el bloqueo en `progress/current.md` y cambia el estado a `blocked` en
`feature_list.json`.
