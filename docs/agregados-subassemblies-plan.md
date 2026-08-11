# Plan Maestro de Agregados (Sub-ensambles Paramétricos 3D)

**Estado:** Especificación Técnica & Plan de Implementación  
**Fecha:** 2026-08-10  
**Programación:** **FASE POST-3D / PROYECTAR** (Comienza estrictamente al culminar las partes de `docs/projectar-super-3d-plan.md`)  
**Norte de Producto:** Sub-conjuntos paramétricos anidados con Bounding Box local y distribución de posiciones (estándar Promob / Cabinet Vision / Blum Legrabox).

---

## 1. Visión y Diagnóstico de Dominio

### El Problema a Resolver
Actualmente en la carpintería, armar muebles requiere colocar repetidamente grupos de piezas y herrajes (ej. un cuerpo de 3 cajones con sus frentes, laterales, traseras, fondos, correderas y tornillos; o una puerta izquierda con sus 2 bisagras y jaladera). 

Aunque el catálogo ya cuenta con la entidad `Agregado`, la implementación anterior lo trataba como un "snippet plano de tableros" que copiaba piezas sin posición 3D local.

### Principios de la Arquitectura de Agregados
1. **Bounding Box Anidado (Sub-espacio Local):** Un agregado ocupa un hueco delimitado dentro del mueble ($W_{\text{local}}, H_{\text{local}}, D_{\text{local}}$) situado en una coordenada local $(X, Y, Z)$.
2. **Fórmulas aisladas del Mueble:** Las piezas dentro del agregado evalúan sus dimensiones contra $W_{\text{local}}, H_{\text{local}}, D_{\text{local}}$, no contra las medidas totales del mueble ($PW, PH, PD$).
3. **Apilamiento y Distribución (Stacking Grid):** Al definir `quantity: N` (ej. 3 cajones), el motor distribuye automáticamente los $N$ sub-conjuntos dividiendo la altura o el ancho y calculando el offset de cada unidad $i$.
4. **Redefinición (Overrides) por Mueble:** Se pueden redefinir medidas por defecto, espejear (`mirrored`), o cambiar modelos de herrajes (ej. cambiar jaladera estándar por perfil Gola) sin alterar la plantilla del catálogo.

---

## 2. Definición del Dominio TypeScript (`@muebles/domain`)

El tipo `ModuleAgregadoInstance` en `packages/domain/src/types.ts` evolucionará a:

```ts
export interface ModuleAgregadoInstance {
  readonly id: string; // ID único de la instancia instalada en el mueble
  readonly agregadoId: string; // Referencia a la plantilla en el catálogo
  readonly name?: string; // Nombre personalizado ej. "Juego 3 Cajones Inferiores"
  
  // Posicionamiento 3D dentro del mueble
  readonly position: {
    readonly xFormula?: string; // Ej: "T" (tras lateral izq)
    readonly yFormula?: string; // Ej: "0"
    readonly zFormula?: string; // Ej: "B + 20" (sobre zócalo)
  };
  
  // Dimensiones del hueco ocupado por el sub-ensamble
  readonly dimensions: {
    readonly widthFormula?: string;  // Ej: "PW - 2*T" (ancho libre)
    readonly heightFormula?: string; // Ej: "600"
    readonly depthFormula?: string;  // Ej: "PD - 20"
  };
  
  // Apilamiento y cantidad
  readonly quantity: number; // Ej: 3 cajones
  readonly layoutDirection?: 'vertical' | 'horizontal' | 'none'; // Ej: 'vertical'
  readonly gapMm?: number; // Luz/separación entre frentes (ej: 3mm)
  
  // Overrides y Espejeado
  readonly mirrored?: boolean;
  readonly optionOverrides?: Record<string, string>; // Ej: { JALADERA: 'jaladera-gola' }
}
```

---

## 3. Desglose en Fases e Issues de Trabajo

Las siguientes 4 fases forman la hoja de ruta de implementación para el sistema de Agregados al terminar el plan de Proyectar/3D:

### 📍 Fase 1 — Motor Paramétrico de Sub-espacios y Apilamiento (Domain Engine)
- **Objetivo:** Actualizar `@muebles/domain` (`agregados.ts`, `bom.ts`, `eval.ts`) para resolver instancias de agregados dentro de su Bounding Box local.
- **Entregables:**
  - `resolveAgregadoInstance()` genera posiciones $(X, Y, Z)$ locales para cada copia $i \in [0 \dots N-1]$.
  - `expandComponentInstances()` acepta `geomDims` locales ($W_{\text{local}}, H_{\text{local}}, D_{\text{local}}$) para que las fórmulas de piezas dentro de cajones/puertas sean exactas.
  - Tests unitarios en `agregados.test.ts` probando 3 cajones apilados verticalmente y puertas espejeadas.

### 📍 Fase 2 — Formulario e Interfaz de Agregados en Muebles (UI Estructuras)
- **Objetivo:** Permitir a los diseñadores agregar, editar y posicionar Agregados desde la interfaz de usuario en `packages/ui/src/structures`.
- **Entregables:**
  - Nueva pestaña **"Agregados"** en `StructureEditorForm.tsx`.
  - Selector de Agregado del catálogo con preview de piezas/herrajes.
  - Formulario de parametrización: Posición $Z$, Ancho libre, Alto del hueco, Cantidad $N$, dirección de apilamiento y luz `gapMm`.
  - Soporte de redefinición de herrajes y toggle `mirrored` (Espejear).

### 📍 Fase 3 — Visualización 3D Interactiva y Jerarquía en Escena (`preview3d`)
- **Objetivo:** Representar y manipular espacialmente los Agregados en el visor 3D R3F (`FurnitureScene3D`).
- **Entregables:**
  - `previewComponentPart.ts` ubica visualmente las piezas de los agregados en sus coordenadas calculadas $(X, Y, Z)$.
  - Agrupación en la escena 3D: Seleccionar un cajón resalta todo el cuerpo del sub-ensamble.
  - Inspector 3D: Ajustar la altura o posición $Z$ del agregado refresca la escena 3D en tiempo real.

### 📍 Fase 4 — Integración en Cotizaciones, Exportación (Optimizer/QR) y Persistencia
- **Objetivo:** Garantizar la trazabilidad completa del taller desde la cotización hasta la producción.
- **Entregables:**
  - Despiece acumulado en el BOM del proyecto con etiquetas de agrupación (ej: `[Cajón 1] Frente`, `[Cajón 1] Lateral Izq`).
  - Exportación a `Plantilla_Optimizer.xlsx` etiquetada correctamente para la escuadradora/CNC.
  - Persistencia en mapeadores de `packages/storage` y endpoints de `backend-go`.

---

## 4. Matriz de Dependencias y Cronograma

```
[ docs/projectar-super-3d-plan.md ]  (Mejoras de Proyectar & 3D en curso)
                │
                ▼ (Al completar Fases 0–6 de 3D)
┌────────────────────────────────────────────────────────────────────────┐
│ FASE 1: Motor Paramétrico Sub-espacios (Domain Engine & Stacking)      │
└────────────────────────────────────────────────────────────────────────┘
                │
                ▼
┌────────────────────────────────────────────────────────────────────────┐
│ FASE 2: Formulario UI Agregados en Muebles (Structure Editor Tab)      │
└────────────────────────────────────────────────────────────────────────┘
                │
                ▼
┌────────────────────────────────────────────────────────────────────────┐
│ FASE 3: Visualización & Jerarquía 3D Interactiva (preview3d)           │
└────────────────────────────────────────────────────────────────────────┘
                │
                ▼
┌────────────────────────────────────────────────────────────────────────┐
│ FASE 4: Cotización, Export Optimizer & Persistencia Storage/Go        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Referencias y Archivos Afectados

- **Documentación de referencia:** `docs/prd.md`, `docs/architecture.md`, `docs/projectar-super-3d-plan.md`
- **Paquetes involucrados:**
  - `packages/domain/src/agregados.ts`, `types.ts`, `engine/bom.ts`
  - `packages/ui/src/agregados/`, `packages/ui/src/structures/`, `packages/ui/src/preview3d/`
  - `packages/excel/src/optimizerExport.ts`
  - `packages/storage/` & `backend-go/`
