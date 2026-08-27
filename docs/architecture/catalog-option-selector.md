# Arquitectura del Sistema de Selección de Modelos, Acabados y Opciones de Catálogo

> **Estado:** CANONICAL  
> **Fecha:** 2026-08-25  
> **Bounded Contexts:** Engineering, Design / Proyectar 3D, Catalog & Libraries, SketchUp Integration  
> **Documentos Relacionados:** [docs/architecture/parametric-furniture-library.md](parametric-furniture-library.md), [docs/architecture/sketchup-interaction-model.md](sketchup-interaction-model.md), [docs/architecture/domain-model.md](domain-model.md), [docs/proyectar-3d-north-star.md](../proyectar-3d-north-star.md), [docs/sketchup-manufacturing-contract.md](../sketchup-manufacturing-contract.md), [docs/architecture/material-aware-furniture-resolution.md](material-aware-furniture-resolution.md)
> **Invariante Central:** **No a los ComboBox gigantes. La selección de catálogo en Granete escala mediante un navegador visual jerárquico por columnas (Miller Columns), desacoplado de la manufactura y uniforme entre la Web 3D y SketchUp.**

---

## 1. Resumen Ejecutivo y Principio Fundamental

Conforme Granete y los talleres asociados crecen, la cantidad de opciones disponibles aumenta sustancialmente:
- múltiples tableros y melaminas con distintas categorías configuradas por el taller;
- modelos y diseños constructivos de componentes (puertas lisas, Shaker, ranuradas, uñeros);
- catálogos de jaladeras y herrajes con medidas intereje (CC) y acabados;
- herrajes funcionales (bisagras, correderas, elevadores);
- materiales ambientales para escenografía 3D (pisos, muros, techos).

### El problema de los selectores tradicionales (Anti-patrón ComboBox)
Los selectores desplegables estándar (`<select>`, dropdowns monolíticos) no escalan adecuadamente cuando el número de ítems supera unas pocas decenas:
1. **Sobrecarga cognitiva:** listas extensas donde el usuario debe memorizar códigos o hacer scroll continuo.
2. **Ausencia de contexto visual:** no permiten apreciar texturas PBR, colores, perfiles ni geometría 3D.
3. **Pérdida de jerarquía del taller:** no reflejan la estructura de categorías definida en el catálogo.

### La solución: Navegador Visual por Columnas (Miller Columns)
Inspirado conceptualmente en la vista por columnas de administradores de archivos modernos (como Finder en macOS), el selector organiza la exploración en una cascada progresiva:

```text
Nivel 1 (Categoría Raíz configurada por el taller)
   ↓
Nivel 2 (Subcategoría intermedia)
   ↓
Nivel 3 (Subcategoría hoja)
   ↓
Panel de Opciones (Grid/Lista visual con swatches, previews y especificaciones)
   ↓
Inspector / Ficha Técnica (Vista previa detallada, compatibilidad y scope de aplicación)
```

> **Regla de Niveles:** Los niveles 1, 2 y 3 **no tienen un significado semántico fijo** (no están amarrados a "Fabricante", "Colección" ni "Tono"). Son categorías jerárquicas configuradas libremente por cada taller mediante `CategoryNode`. El `kind` del selector (tablero, herraje, etc.) es el filtro de contexto inicial y no consume un nivel de la jerarquía.

---

## 2. Modelo Mental y Anatomía Visual del Selector

El selector visual se estructura en **5 zonas funcionales coordinadas**:

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [🔍 Buscar opción en catálogo...]                                 [☑ Solo compatibles] [Filtros]            [✖ Cerrar (Esc)]   │
├──────────────────┬──────────────────┬──────────────────┬────────────────────────────────────────┬───────────────────────────────┤
│ Nivel 1          │ Nivel 2          │ Nivel 3          │ Opciones Disponibles (Grid/Lista)      │ Inspector / Vista Previa      │
│ (Cat. Raíz)      │ (Subcategoría)   │ (Subgrupo)       │                                        │                               │
├──────────────────┼──────────────────┼──────────────────┼────────────────────────────────────────┼───────────────────────────────┤
│ > Maderas        │ > Claras         │ > Robles         │ ┌────────────────┐ ┌────────────────┐  │  ┌─────────────────────────┐  │
│   Unicolores     │   Oscuras        │   Fresnos        │ │ [Preview PBR]  │ │ [Preview PBR]  │  │  │   [ Preview 3D/PBR ]    │  │
│   Piedras        │   Rústicas       │   Nórdicos       │ │ Roble Natural  │ │ Roble Kendal   │  │  │   Visualización amplia  │  │
│   Metales        │                  │                  │ │ MAT-ROB-01     │ │ MAT-ROB-02     │  │  │   del material/modelo   │  │
│                  │                  │                  │ │ 18mm • Veta SÍ │ │ 18mm • Veta SÍ │  │  └─────────────────────────┘  │
│                  │                  │                  │ └────────────────┘ └────────────────┘  │  Roble Natural                │
│                  │                  │                  │ ┌────────────────┐ ┌────────────────┐  │  Código: MAT-ROB-01           │
│                  │                  │                  │ │ [Preview PBR]  │ │ [Preview PBR]  │  │  Espesor: 18 mm | Veta: SÍ    │
│                  │                  │                  │ │ Roble Rústico  │ │ Roble Halifax  │  │  Tapacanto default: TAP-01    │
│                  │                  │                  │ │ MAT-ROB-03     │ │ MAT-ROB-04     │  │  Compatibilidad: ✅ Válido    │
│                  │                  │                  │ │ 18mm • Veta SÍ │ │ 18mm • Veta SÍ │  │ ───────────────────────────── │
│                  │                  │                  │ └────────────────┘ └────────────────┘  │  Aplicar a:                   │
│                  │                  │                  │                                        │  (o) Frentes del mueble       │
│                  │                  │                  │                                        │  ( ) Frentes de toda la obra  │
│                  │                  │                  │                                        │  [ Aplicar Selección (↵) ]   │
└──────────────────┴──────────────────┴──────────────────┴────────────────────────────────────────┴───────────────────────────────┘
```

### Descripción de las Zonas:

1. **Columna Nivel 1 (Categoría Raíz):** Nodos sin `parentId` dentro del árbol de categorías configurado por el taller para la entidad activa.
2. **Columna Nivel 2 (Subcategoría Nivel 2):** Nodos cuyo `parentId` es el nodo seleccionado en Nivel 1.
3. **Columna Nivel 3 (Subcategoría Nivel 3):** Nodos hoja o subgrupos de tercer nivel. Si el árbol de una categoría tiene menor profundidad (1 o 2 niveles), las columnas no utilizadas se colapsan automáticamente.
4. **Panel de Opciones (Candidate Grid / List):** Presenta las opciones finales elegibles según la categoría seleccionada (o resultados de búsqueda). Tarjetas con vista previa, nombre comercial, código, espesores y estado.
5. **Panel de Detalle / Inspector:** Muestra vista previa ampliada, ficha técnica de la opción seleccionada, diagnóstico de compatibilidad y control de **Scope de Aplicación**.

---

## 3. Modelo Conceptual: Role, Model y Finish

Para mantener alineación con la arquitectura de muebles paramétricos (`smartFurnitureDomain.ts`), la selección distingue tres conceptos ortogonales:

```text
┌────────────────────────┐       ┌────────────────────────┐       ┌────────────────────────┐
│          ROLE          │  ──►  │         MODEL          │  ──►  │         FINISH         │
│ (Función constructiva) │       │ (Geometría / Diseño)   │       │ (Material / Acabado)   │
└────────────────────────┘       └────────────────────────┘       └────────────────────────┘
```

1. **Role (Función del Componente o Slot):**
   - Determina el propósito dentro del mueble (`door`, `drawer_front`, `shelf`, `left_side`, `handle`, etc.).
   - Define qué opciones son constructivamente admisibles.
2. **Model (Geometría / Diseño del Componente):**
   - Corresponde a la definición de la pieza o herraje (`ComponentDefinition` para piezas/puertas; `Hardware` para tiradores/herrajes).
   - Ejemplo en puertas: Modelo *Shaker*, Modelo *Lisa (Flat)*, Modelo *Ranurada (Ribbed)*.
   - Ejemplo en jaladeras: Modelo *Bar-Pull 128mm CC*, Modelo *Knob Ø30mm*, Modelo *Perfil Gola*.
3. **Finish (Apariencia / Material / Acabado Superficial):**
   - Define el aspecto visual y físico aplicado sobre el modelo.
   - En tableros/piezas: `MaterialBoard` asignado (ej. Melamina Arauco Nougat 18mm).
   - En herrajes: `HardwareFinish` aplicado (ej. `black-matte`, `chrome`, `gold`).

### Combinatorias según la Naturaleza del Rol
No todos los roles requieren las tres dimensiones de forma simultánea:
- **Roles con sólo Material/Finish:** Placas estándar de estructura o entrepaños (`carcass`, `shelf`, `back_panel`) donde la geometría es una pieza plana rectangular derivada paramétricamente y el usuario sólo selecciona el tablero/acabado (`MaterialBoard`).
- **Roles con Model + Finish:** Componentes decorativos o frontales (`door`, `drawer_front`, `handle`) donde se elige tanto el diseño geométrico (`ComponentDefinition` Shaker / `Hardware` Bar-Pull 128) como su acabado superficial (`MaterialBoard` Nougat / `HardwareFinish` Negro Mate).
- **Roles con sólo Model / sin Finish seleccionable:** Herrajes mecánicos o conectores funcionales (correderas ocultas, bisagras estándar, tarugos, minifix) donde el modelo define el ensamble y no existe un acabado decorativo configurable por el usuario.

---

## 4. Estado de Contratos: CURRENT vs PROPOSED

### 4.1 Contratos Existentes en Dominio [CURRENT]

#### Árbol de Categorías (`CategoryNode`)
Definido en `packages/domain/src/types.ts`:
```typescript
// [CURRENT]
export interface CategoryNode {
  readonly id: string;
  readonly name: string;
  /** Parent category id; omit/undefined for root-level categories. */
  readonly parentId?: string;
  readonly sortOrder: number;
}

export type ModuleCategory = CategoryNode;
export type AmbientCategory = CategoryNode;
export type MaterialCategory = CategoryNode;
```

#### Tipos de Grupos de Opciones (`OptionGroupKind`)
Definido en `packages/domain/src/types.ts`:
```typescript
// [CURRENT]
export type OptionGroupKind = 'board' | 'hardware' | 'edge';

export interface OptionGroup {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: OptionGroupKind;
  readonly required: boolean;
  readonly optionIds: readonly string[];
}

export type OptionChoices = { readonly [optionGroupCode: string]: string };
```

#### Superficies de Materiales Ambientales (`AmbientSurfaceType`)
Definido en `packages/domain/src/types.ts`:
```typescript
// [CURRENT]
export type AmbientSurfaceType = 'floor' | 'wall' | 'ceiling';
```
> **Nota de integridad:** `AmbientSurfaceType` soporta actualmente `floor`, `wall` y `ceiling`. Cualquier tipo adicional de superficie es futuro y no forma parte del contrato actual.

#### Resolución de Opciones: Defaults + Overrides (`effectiveOptionChoices`)
Definido en `packages/domain/src/optionChoices.ts`:
```typescript
// [CURRENT]
// Project Defaults + Item Overrides = Effective Choices
export function effectiveOptionChoices(
  itemChoices: OptionChoices | undefined | null,
  projectLevelChoices?: OptionChoices | null,
): OptionChoices;
```
> **Comportamiento canónico:**
> - Los valores definidos a nivel de proyecto (`projectLevelChoices`) actúan como defaults.
> - Los valores explícitos a nivel de ítem (`itemChoices`) actúan como overrides.
> - Para **restablecer (reset) un override** y volver a heredar el default de proyecto, se elimina la clave de `itemChoices` (o se asigna vacía/espacio en blanco).

> **Binding de tablero actual [ENFORCED desde #403 / MT-2]:** `Component.optionRoles`
> persiste como array, pero el único material-binding role es `optionRoles[0]`
> (normalizado: trim, sin vacíos, sin duplicados exactos). Un board con varios roles
> distintos es ambiguo y se rechaza en cuatro capas con la misma semántica:
>
> - resolución TS (`materialBindingRole`, `packages/domain/src/materialRole.ts`);
> - resolución Go (`materialBindingRole`, `backend-go/internal/domain/engine/material_role.go`);
> - autoría (`validateComponent` TS / `ValidateComponent` Go → API 400);
> - editor web (selección exclusiva en la pestaña Opciones + guard al guardar).
>
> El fixture compartido `contracts/materialRoleBinding.contract.json` define la tabla
> de aliases legacy (ZOCLO / PUERTA / PUERTA_* / FRENTE_CAJON → FRENTE, choice directo
> gana) y los casos de binding; TS y Go lo consumen textualmente en sus tests de
> paridad. La UI muestra el nombre del `OptionGroup` (`optionRoleLabel`), nunca el
> código crudo cuando existe nombre. Ver
> [material-aware-furniture-resolution.md](material-aware-furniture-resolution.md) y
> [#403](https://github.com/tiagofur/muebleria/issues/403).

#### Acabados de Herrajes (`hardwareFinishes.ts`)
Definido en `packages/domain/src/hardwareFinishes.ts`:
```typescript
// [CURRENT]
export type HardwareFinishId =
  | 'chrome'
  | 'black-matte'
  | 'bronze'
  | 'brushed'
  | 'gold';

export type HardwareFinish = {
  readonly id: HardwareFinishId;
  readonly name: string;
  readonly color: string;
  readonly metalness: number;
  readonly roughness: number;
  readonly clearcoat: number;
};
```

---

### 4.2 DTOs y Adaptadores Propuestos para el Selector [PROPOSED]

Los siguientes tipos corresponden a la capa de UI / adaptación del selector y no reemplazan las entidades actuales de base de datos ni de dominio:

#### Proyección Universal de Opción de Catálogo (`SelectorOptionItem`) [PROPOSED]
Representa la información intrínseca de una opción de catálogo, independiente del contexto donde se evalúe:

```typescript
// [PROPOSED DTO]
export type SelectorOptionKind = 'board' | 'hardware' | 'edge' | 'component_model' | 'ambient';

export interface SelectorOptionItem {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: SelectorOptionKind;
  readonly categoryId?: string;
  readonly categoryPathIds: readonly string[];
  
  /** Metadata comercial y dimensional para display */
  readonly manufacturer?: string;
  readonly thicknessMm?: number;
  readonly dimensionsSummary?: string;
  readonly inStock?: boolean;
  readonly tags?: readonly string[];

  /** Payload visual para previsualización */
  readonly preview: {
    readonly color?: string;
    readonly textureUrl?: string;
    readonly roughness?: number;
    readonly metalness?: number;
    readonly clearcoat?: number;
    readonly hasGrain?: boolean;
    readonly model3dUrl?: string;
    readonly thumbnail3dUrl?: string;
  };
}
```

#### Candidato Evaluado en Contexto (`SelectorCandidate`) [PROPOSED]
La compatibilidad depende del cruce entre la opción y el contexto de selección activo (`Option + SelectionContext`). Se encapsula en `SelectorCandidate`:

```typescript
// [PROPOSED DTO]
export interface OptionCompatibilityResult {
  readonly isCompatible: boolean;
  readonly incompatibilityReason?: string;
}

export interface SelectorCandidate {
  readonly option: SelectorOptionItem;
  readonly compatibility: OptionCompatibilityResult;
}
```

#### Aplicación Role-Aware de Opciones (`ApplyOptionIntent`) [PROPOSED]
Para mantener coherencia con `OptionGroup.code`, `OptionChoices` y `effectiveOptionChoices()`, la intención de aplicación utiliza `optionGroupCode`:

```typescript
// [PROPOSED]
export type ApplicationScopeLevel =
  | 'selected_furniture'    // Aplica al optionGroupCode dentro del mueble seleccionado
  | 'selected_component'    // Aplica al componente específico seleccionado (drill-down)
  | 'project_default';      // Actualiza el default de la obra (projectLevelChoices)

export interface ApplyOptionIntent {
  readonly optionGroupCode: string;  // ej. 'INTERIOR', 'FRENTES', 'HANDLE_MODEL'
  readonly selectedOptionId: string;
  readonly scope: ApplicationScopeLevel;
  readonly targetFurnitureInstanceId?: string;
  readonly targetComponentInstanceId?: string;
}
```

---

## 5. Separación del Pipeline de Manufactura

El selector visual es un capturador de opciones. No ejecuta por sí solo todo el proceso industrial. La arquitectura mantiene una separación estricta por fases:

```text
┌──────────────────────────────────────────────────────────┐
│ 1. Effective Configuration (OptionChoices)               │
│    effectiveOptionChoices(itemOverrides, projectDefaults)│
└────────────────────────────┬─────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────┐
│ 2. Material Binding + Effective Thickness                │
│    primary optionRole -> MaterialBoard -> effective T     │
└────────────────────────────┬─────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────┐
│ 3. Furniture / Composition Resolution                    │
│    fórmulas geométricas -> pose -> anchors -> AABB        │
└────────────────────────────┬─────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────┐
│ 4. Resolved Parts / Layout DTO                           │
│    piezas con L/W/T, transform y material coherentes     │
└────────────────────────────┬─────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────┐
│ 5. BOM + Manufacturing Features                          │
│    costos, tapacantos, herrajes, CNC, nesting            │
└──────────────────────────────────────────────────────────┘
```

- **Binding + espesor efectivo**: La elección de `MaterialBoard` debe resolverse
  antes de geometría; el espesor nominal sólo es fallback cuando no existe binding
  aplicable.
- **`resolveBom()`**: Consume piezas ya coherentes con su material para calcular
  costos y consumo de tablero/tapacanto/herraje.
- **Geometría y Holguras**: Pertenecen a la capa de composición y motor de mueble
  paramétrico; usan el `T` efectivo, no el nominal tardío.
- **Mecanizados y Perforaciones**: Pertenecen a la derivación de manufactura (`projectDrilling.ts` / `machining`).

---

## 6. Experiencia de Usuario e Interacción

### 6.1 Navegación por Teclado
- **`ArrowRight` / `ArrowLeft`:** Navega entre columnas (Nivel 1 → Nivel 2 → Nivel 3 → Opciones → Inspector).
- **`ArrowDown` / `ArrowUp`:** Navega entre los elementos de la columna activa.
- **`Enter`:** Aplica la opción seleccionada con el scope activo.
- **`Esc`:** Retrocede un nivel en la jerarquía o cierra el selector.
- **`Type-to-Search`:** Filtra en tiempo real sobre la categoría activa o sobre el catálogo completo.

### 6.2 Gestión y Feedback de Incompatibilidad
- **Filtro por Defecto:** Por defecto, el selector muestra únicamente los candidatos compatibles (`isCompatible: true`) para mantener una vista limpia y enfocada.
- **Visualización de Incompatibles:** La UI proporciona un interruptor/filtro ("Mostrar incompatibles").
- **Explicación del Motivo:** Al mostrarse, los candidatos incompatibles aparecen visiblemente atenuados/deshabilitados con un badge o tooltip explicativo claro (ej. *"Incompatible: Tirador excede ancho de frente (mínimo 350mm)"* o *"Espesor de tablero no admitido en ensamble"*).
- **Invariante de Bloqueo:** Una opción incompatible **nunca puede aplicarse silenciosamente**. El botón de aplicación y el atajo `Enter` permanecen deshabilitados para cualquier candidato incompatible.

### 6.3 Ciclo de Selección
El contrato de interacción base es:
```text
Abrir selector → Explorar / Filtrar → Seleccionar candidato → [ Aplicar ] / [ Cancelar ]
```
- No hay mutación definitiva del estado del proyecto ni del mueble hasta que el usuario confirma con **Aplicar** o presiona `Enter`.
- *[FUTURE ENHANCEMENT]*: La previsualización en vivo en el canvas 3D antes de confirmar (Live Ghost Preview) se contempla como una mejora posterior, manteniendo la confirmación explícita como base.

---

## 7. Adaptación de Layout Multi-Plataforma

El selector utiliza el mismo modelo de datos y contratos en todas las plataformas, adaptando su presentación al espacio disponible:

```text
Desktop Web (Vista Amplia):
┌──────────┬──────────┬──────────┬──────────────────┬──────────────────┐
│ Nivel 1  │ Nivel 2  │ Nivel 3  │ Opciones (Grid)  │ Detalle / Scope  │
└──────────┴──────────┴──────────┴──────────────────┴──────────────────┘

SketchUp / Panel Estrecho (Vista Compacta):
┌──────────────────────────────────────────────────────────────────────┐
│ [ Breadcrumb: Maderas › Claras › Robles ]             [🔍 Buscar]   │
├──────────────────────────────────────────────────────────────────────┤
│ [ < Volver a Claras ]                                                │
│ > Robles                                                             │
│   Fresnos                                                            │
│   Nórdicos                                                           │
├──────────────────────────────────────────────────────────────────────┤
│ Opciones Disponibles (Lista con miniaturas y detalles)               │
├──────────────────────────────────────────────────────────────────────┤
│ Ficha / Selector de Scope / [ Aplicar ]                              │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 8. Principios de Rendimiento y Escala

En lugar de imponer métricas teóricas no medidas, el desarrollo del selector debe regirse por los siguientes principios técnicos:

1. **Lazy Loading:** Carga de imágenes y texturas bajo demanda conforme el usuario navega o visualiza las tarjetas.
2. **Thumbnails Ligeros:** El grid de opciones debe utilizar miniaturas visuales optimizadas; nunca cargar texturas PBR completas de alta resolución ni modelos 3D densos para listar tarjetas en el grid.
3. **Caché en Memoria:** El árbol de categorías y el índice del catálogo deben residir en memoria durante la sesión para que los cambios de columna sean instantáneos.
4. **Virtualización Proporcional:** Implementar virtualización de lista/grid en el panel de opciones si el perfilado (*profiling*) de rendimiento muestra degradación con catálogos densos.
5. **Aislamiento de Re-renders:** La navegación entre columnas del selector no debe provocar re-renderizados innecesarios del canvas 3D principal.

---

## 9. Regla Anti-Leak de Materiales (Garantía F086 / F142)

- **Separación estricta por naturaleza:**
  - `MaterialBoard` (tableros cotizables con precio, desperdicio, tapacanto y veta) sólo pueden seleccionarse para roles constructivos de muebles.
  - `AmbientMaterial` (materiales decorativos de escenografía 3D para `floor`, `wall`, `ceiling`) sólo pueden seleccionarse para superficies de habitación.
  - El selector filtra por `kind` al abrirse, asegurando que un `AmbientMaterial` jamás contamine `OptionChoices` ni el cálculo de costos de producción.
