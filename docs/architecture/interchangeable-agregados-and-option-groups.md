# Intercambio de Agregados por Rol y Grupos de Agregados

- **Estado:** Propuesto — especificación arquitectónica y plan por etapas.
- **Fecha:** 2026-11-03.
- **Bounded Contexts:** Engineering, Catalogs, Option Selector, Assembly & BOM Engines, SketchUp Integration.
- **Documentos Relacionados:**
  - [`docs/architecture/catalog-option-selector.md`](catalog-option-selector.md)
  - [`docs/architecture/opening-front-system.md`](opening-front-system.md)
  - [`docs/architecture/hardware-3d-assets-and-assemblies.md`](hardware-3d-assets-and-assemblies.md)
  - [`docs/architecture/parametric-furniture-library.md`](parametric-furniture-library.md)

---

## 1. Problema y Motivación

Actualmente en Granete, un subensamble (`Agregado`) colocado en una estructura o módulo (`ModuleAgregadoInstance`) tiene un `agregadoId` fijo codificado en la plantilla del mueble.

Al diseñar proyectos reales, los clientes o el taller necesitan alternar libremente entre:
1. **Diseños de puertas y frentes:** Puerta lisa, Shaker (5 piezas), ranurada o con tirador perfil de aluminio integrado (J-pull).
2. **Sistemas de cajón:** Correderas telescópicas laterales, correderas bajo fondo ocultas (ej. Blum TANDEM) o cajones con costados metálicos de plataforma (ej. Blum MERIVOBOX).
3. **Tecnologías de movimiento:** Cierre suave amortiguado (*Blumotion*), apertura por empuje (*Tip-On / Push to Open*) o asistencia electromecánica (*Servo-Drive*).

Si cada combinación requiere crear una nueva `Structure` o `Module` en el catálogo, se produce una **explosión combinatoria** ($3 \text{ frentes} \times 3 \text{ cajones} \times 3 \text{ movimientos} = 27$ variantes por cada mueble cajonero).

Además, un frente y una caja de cajón tienen naturalezas físicas diferentes:
- Un cajón telescópico requiere 4 piezas perimetrales de tablero de madera, piso ranurado/clavado y correderas de montaje lateral con descuentos de ancho de ~25–26 mm.
- Un cajón Blum MERIVOBOX no fabrica costados de madera: usa costados metálicos rígidos comprados, sólo corta piso y trasera de madera con las fórmulas oficiales del fabricante, e incorpora un kit comercial.
- Un frente Shaker requiere despiece de 5 tableros ensamblados, mientras que un frente liso es un único tablero.

## 2. Principio Arquitectónico

> **El Vano pertenece al Mueble; la Construcción Interna pertenece al Agregado.**

El mueble/estructura define el **hueco disponible (`spaceW`, `spaceH`, `spaceD`)** y la cantidad/distribución de vanos (`quantity`, `layoutDirection`, `gapMm`).

El `Agregado` concreto asignado a ese vano es intercambiable mediante el sistema unificado de opciones (`OptionChoices`), resolviéndose con la misma jerarquía de precedencia que gobierna tableros y herrajes:
$$\text{Override en Instancia} \rightarrow \text{Elección en Mueble (`item.optionChoices`)} \rightarrow \text{Default del Proyecto (`projectLevelChoices`)} \rightarrow \text{`agregadoId` base}$$

## 3. Modelo de Entidades y Extensiones de Contrato

### 3.1. Extensión de `OptionGroupKind`
En `packages/domain/src/types.ts` y contratos Go:
```typescript
export type OptionGroupKind = 'board' | 'hardware' | 'edge' | 'agregado';
```
Un `OptionGroup` con `kind: 'agregado'` tiene `optionIds` que referencian identificadores válidos de `Agregado` en el catálogo.

Ejemplos de grupos configurados por el taller:
- `PUERTA_GABINETE`: `[agr-puerta-lisa-inf, agr-puerta-shaker-inf, agr-puerta-perfil-sup]`
- `PUERTA_ALACENA`: `[agr-puerta-lisa-sup, agr-puerta-shaker-sup, agr-puerta-perfil-inf]`
- `FRENTE_CAJON`: `[agr-frente-liso, agr-frente-shaker, agr-frente-perfil]`
- `CAJA_CAJON`: `[agr-cajon-telescopico, agr-cajon-tandem-oculto, agr-cajon-merivobox-m]`

### 3.2. Extensión de `ModuleAgregadoInstance`
En `packages/domain/src/types.ts` y `backend-go/internal/domain/module.go`:
```typescript
export interface ModuleAgregadoInstance {
  readonly id?: string;
  readonly agregadoId: string;       // Default / fallback de la plantilla
  readonly optionRole?: string;       // Código del OptionGroup (ej. 'CAJA_CAJON', 'PUERTA_GABINETE')
  readonly name?: string;
  readonly quantity: number;
  readonly layoutDirection?: 'vertical' | 'horizontal' | 'none';
  readonly gapMm?: number;
  readonly position?: AgregadoPosition;
  readonly dimensions?: AgregadoDimensions;
  readonly mirrored?: boolean;
  readonly optionOverrides?: Record<string, string>;
}
```

### 3.3. Resolución del Agregado Efectivo
Función pura con paridad idéntica en TypeScript y Go:
```typescript
export function resolveEffectiveAgregadoId(
  instance: ModuleAgregadoInstance,
  optionChoices?: OptionChoices | null,
): string {
  if (instance.optionRole) {
    const instanceOverride = instance.optionOverrides?.[instance.optionRole]?.trim();
    if (instanceOverride) return instanceOverride;

    const groupChoice = optionChoices?.[instance.optionRole]?.trim();
    if (groupChoice) return groupChoice;
  }
  return instance.agregadoId;
}
```

La resolución es *fail-closed*: si un grupo requerido no tiene selección válida ni fallback disponible en catálogo, la resolución reporta diagnóstico explícito (`UNRESOLVED_AGREGADO_ROLE`).

## 4. Puntos de Integración en el Pipeline

La resolución de `effectiveAgregadoId` se conecta en todos los puntos donde se consumen agregados:
1. **Despiece y BOM:**
   - TS: `packages/domain/src/engine/bom.ts` y `packages/domain/src/agregados.ts`
   - Go: `backend-go/internal/domain/engine/resolve.go`
2. **Ensambles Paramétricos y Representación 3D:**
   - TS: `packages/domain/src/agregadoAssembly.ts`
   - Go: `backend-go/internal/domain/engine/layout.go` y `assembly_resolver.go`
3. **Perforaciones y Maquinado CNC:**
   - TS: `packages/domain/src/projectDrilling.ts`
   - Go: `backend-go/internal/domain/engine/hardware_placement_demand.go`
4. **Descubrimiento Dinámico de Roles Hijos (UI):**
   - Al seleccionar un `Agregado` diferente, sus propios roles dependientes (ej. tableros interiores, jaladeras o guías) se descubren dinámicamente en `collectAgregadoRoles()` y `usedOptionRolesForModule()` para que los pickers de opciones muestren únicamente los roles pertinentes al agregado activo.

---

## 5. Roadmap de Implementación (3 Etapas)

### Etapa 1: Grupos de Agregados y Selección por Rol (1 a 1)
- **Alcance:**
  - `OptionGroupKind = 'agregado'` en tipos y esquemas.
  - Soporte de administración de grupos de agregados en `OptionGroupsScreen`.
  - Atributo `optionRole` en `ModuleAgregadoInstance` (editor de estructuras/módulos).
  - Selector de opciones en los 3 niveles: Default de Proyecto, Override por Mueble e Instancia.
  - Resolución simétrica en TS y Go para BOM, Layout 3D y Perforaciones.
  - Fixtures de contrato y paridad compartida (`contracts/fixtures/`).

### Etapa 2: Selección Automática por Banda de Altura de Vano
- **Alcance:**
  - Para sistemas de cajones metálicos modulares (ej. Merivobox M, K, E), permitir que un rol como `SISTEMA_CAJON` seleccione automáticamente el agregado correspondiente según la altura neta `unit.height` de cada vano.
  - Reutilización del patrón de políticas de bandas probado en `hingeDemand.ts`.

### Etapa 3: Restricciones y Reglas de Compatibilidad (Gola / Movimiento)
- **Alcance:**
  - Reglas de exclusión entre sistemas de apertura y agregados (ej. módulos con Gola activo filtran o bloquean agregados con jaladera perfil o variantes Push-to-Open incompatibles).
  - Validación *fail-closed* en preflight y cotización formal.
