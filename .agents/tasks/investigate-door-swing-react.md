# Investigación: UI para `doorSwing` en la app React

## Resumen ejecutivo

**No existe ningún componente React que permita al usuario definir o editar el parámetro `doorSwing` (ni ningún otro parámetro tipado del catálogo piloto) en los ítems de un proyecto/presupuesto.**

`doorSwing` está definido como parámetro `enum` (`left` / `right` / `pair`) en la definición de dos muebles del catálogo piloto (`furniture-base-door` y `furniture-wall-door`), y aparece en los presets de `pilotFurniturePresets`. Sin embargo, ese catálogo piloto **no está importado ni consumido en ningún componente UI ni en la app web** — su único uso fuera de su propio archivo es en el test de contrato `pilotFurnitureCatalog.contract.test.ts`.

---

## Evidencia detallada

### 1. Dónde vive `doorSwing`

**Archivo:** `packages/domain/src/pilotFurnitureCatalog.ts`

```
{ name: "doorSwing", label: "Apertura", type: "enum", defaultValue: "left",
  options: ["left", "right", "pair"], category: "metadata" }
```

Aparece en las definiciones de:
- `furniture-base-door` (línea 398)
- `furniture-wall-door` (línea 455)

Y en los presets `pilotFurniturePresets` (líneas 504–512):
- `base-1-door-left` → `doorSwing: "left"`
- `base-1-door-right` → `doorSwing: "right"`
- `base-2-doors` → `doorSwing: "pair"`
- `wall-1-door-left` → `doorSwing: "left"`
- `wall-1-door-right` → `doorSwing: "right"`
- `wall-2-doors` → `doorSwing: "pair"`

### 2. El catálogo piloto no está integrado en la UI

Búsqueda de `pilotFurnitureCatalog`, `pilotFurnitureDefinitions`, `pilotFurniturePresets`, `PilotFurniturePreset` en todo el código fuente (excluidos tests y node_modules): **cero resultados en `apps/web/` o `packages/ui/`**.

El catálogo piloto existe como artefacto de dominio puro, publicado como contrato JSON (`contracts/pilotFurnitureCatalog.json`), pero la app React no lo consume directamente.

### 3. Cómo se manejan los parámetros de ítems hoy

El tipo `ProjectItem` (`packages/domain/src/types.ts`, línea 862) tiene estos campos editables:

| Campo | Descripción |
|---|---|
| `optionChoices` | Selección de tablero/frente/herraje por grupo de opción |
| `measurePresetId` | ID del preset de medida (`Module.presets`) |
| `customDims` | Override manual de W/H/D en mm |
| `baseMode` | Tratamiento de base (zócalo, patas, etc.) |

**No hay campo `parameters` ni campo `doorSwing` en `ProjectItem`.**

Los parámetros tipados del catálogo piloto (`widthMm`, `heightMm`, `doorCount`, `doorSwing`, `shelfCount`, etc.) son propios del modelo `FurnitureDefinition` y viajan en el contrato `parameters: Record<string, string|number|boolean>` de las entidades de diseño (SketchUp authoring, revisiones), pero **no existen como campo editable en los ítems de cotización de la UI React**.

### 4. Handlers de edición disponibles

`ProjectDetailItemHandlers` (`packages/ui/src/projects/components/projectDetailContext.tsx`, línea 127):

```typescript
export interface ProjectDetailItemHandlers {
  onUpdateItemQuantity(item, quantity): void;
  onUpdateItemMeasurePreset(item, measurePresetId): void;
  onUpdateItemChoice(item, groupCode, optionId): void;
  onRemoveItem(projectId, itemId): void;
  onReorderItems?(fromIndex, toIndex): void;
}
```

**No hay `onUpdateItemParameters` ni nada similar.**

### 5. Panel de edición de mueble (ProjectItemsSection)

`packages/ui/src/projects/components/ProjectItemsSection.tsx` renderiza por cada ítem:
- Campo `<input type="number">` para cantidad
- `<select>` para preset de medida (si el módulo tiene presets)
- `<select>` por cada grupo de opción (INTERIOR, FRENTE, ZOCLO, etc.)

No hay inputs para parámetros del catálogo piloto.

### 6. Modal de agregar mueble (ProjectAddItemModal)

`packages/ui/src/projects/components/ProjectAddItemModal.tsx`: permite elegir módulo del catálogo clásico (`Module` de SketchUp), cantidad, preset de medida y grupos de opción. No hay selección de preset piloto ni campos para `doorSwing` u otros parámetros del catálogo piloto.

### 7. Panel de parámetros que SÍ existe (pero es para admins)

`packages/ui/src/modules/components/ModuleEditorParametersPanel.tsx`: este panel existe y maneja `FurnitureParameter` con su campo `category: 'metadata'` (lo que incluye `doorSwing`). Sin embargo, es el editor de **definiciones del catálogo** (para carpinteros-administradores que definen módulos), **no el panel de configuración de ítems en un proyecto**.

### 8. Visualización de parámetros en el hilo digital

`packages/ui/src/digitalThread/ProjectFurnitureScreen.tsx` (línea 1229) muestra los parámetros de un ítem de revisión de cotización:

```tsx
{Object.entries(quoteItem.parameters).map(([key, value]) => (
  <li key={key}><span>{key}</span><span>{String(value)}</span></li>
))}
```

Pero es **solo lectura** — muestra pares `key: value` sin etiquetas amigables ni inputs de edición.

---

## Conclusiones

1. **`doorSwing` existe solo en el dominio piloto** — no está expuesto en ningún componente de la UI de proyectos.

2. **El modelo `ProjectItem` no tiene campo `parameters`** — los parámetros tipados del catálogo piloto (`doorSwing`, `shelfCount`, `doorCount`, etc.) no tienen lugar de almacenamiento en la cotización React actual.

3. **Los ítems de cotización solo guardan: módulo clásico + opciones de tablero/frente/herraje + preset de medida**. La granularidad del catálogo piloto (con sus `FurnitureDefinition` y `FurnitureParameter`) no está conectada al flujo de cotización de la app web.

4. **El catálogo piloto es un artefacto de dominio autónomo** — tiene definiciones completas, presets con `doorSwing` fijado, y un contrato JSON publicado. Pero la app React no lo consume.

---

## Recomendaciones para agregar UI de selección de apertura

Para que el usuario pueda definir `doorSwing` en un ítem, hay dos caminos:

### Camino A — Presets del catálogo piloto (recomendado a corto plazo)

Los `pilotFurniturePresets` ya resuelven `doorSwing` por nombre (`base-1-door-left`, `base-1-door-right`, etc.). La solución más rápida es:

1. Agregar un campo `pilotPresetId?: string` a `ProjectItem` (o reutilizar `measurePresetId` si el ítem es piloto).
2. En `ProjectAddItemModal` y `ProjectItemsSection`, cuando el módulo corresponde a un `furnitureDefinitionId` del catálogo piloto, mostrar un `<select>` con los presets agrupados por `category` (base/wall/tall). El preset lleva `doorSwing` como valor fijo — el usuario elige "1 Puerta Izquierda" sin conocer el nombre del enum.
3. Al guardar el ítem, persistir el `pilotPresetId` y sus `parameters` resueltos.

**Ventaja:** no requiere un editor de parámetros genérico; los nombres de los presets son descriptivos para el usuario final.

### Camino B — Editor de parámetros genérico por item (largo plazo)

1. Agregar `parameters?: Record<string, string|number|boolean>` a `ProjectItem`.
2. Crear un `ItemParametersPanel` que consuma las `FurnitureParameter[]` del módulo y renderice un input por tipo: `number` → `<input type="number">`, `enum` → `<select>` con las opciones y sus etiquetas, `boolean` → `<input type="checkbox">`.
3. Agregar `onUpdateItemParameters` a `ProjectDetailItemHandlers` y conectarlo al store.
4. Renderizar el panel en `ProjectItemsSection` debajo de los grupos de opción cuando el módulo tenga `parameterDefinitions`.

**Ventaja:** generaliza para cualquier módulo paramétrico. **Desventaja:** requiere más trabajo y que las `FurnitureParameter` del módulo clásico de SketchUp estén definidas (hoy solo el catálogo piloto las tiene formalmente).

---

*Investigación realizada el 2025-07. No se modificó ningún archivo.*
