# Ingeniería — Workspace de documentación y verificación

**Fase:** 2 | **Prioridad:** ALTA | **Esfuerzo:** 2-3 semanas

---

## 0. Purpose

Dedicated workspace for engineering roles to verify designs, generate factory documentation, and prepare the complete documentation package before handing off to production. Separates "what to build" (engineering) from "how to build it" (factory).

---

## 1. Who sees it

| Role | Access | Scope |
|------|--------|-------|
| admin | ✅ full | All projects |
| ingeniero | ✅ full | All projects |
| gerente_produccion | 👁 read-only | All projects |
| gerente_ventas | 👁 read-only | All projects |
| vendedor | 👁 read-only | Own projects only |
| produccion | ❌ | — |
| almacen | ❌ | — |

---

## 2. Relationship with existing Ingeniería ABM

The existing **Ingeniería ABM** section (Composición + Materiales) stays exactly as-is:

```
INGENIERÍA (nav section — no se toca)
├── Composición
│   ├── Muebles
│   ├── Estructuras
│   ├── Agregados
│   ├── Componentes
│   └── Catálogos
├── Materiales
│   ├── Materiales
│   ├── Cantos
│   ├── Herrajes
│   ├── Acabados
│   └── Grupos
```

The new **Ingeniería screen** is a separate nav item for project-level documentation work. It opens when the engineer selects a specific project to verify and generate docs.

---

## 3. Screen structure

```
INGENIERÍA
├── [Pantalla principal: lista de proyectos]
└── [Proyecto seleccionado — workspace]
    ├── [Resumen] [Módulos] [Despiece] [Vistas] [Optimización] [Documentos]
```

### 3.1 Pantalla principal — Lista de proyectos de Ingeniería

Al entrar a Ingeniería, el ingeniero ve la **lista de proyectos** que le competen. Desde acá acepta un proyecto y da inicio a la documentación. Esta pantalla registra quién generó la ingeniería y cuándo, lo que sirve para comunicación interna, trazabilidad y estadísticas de acompañamiento de producción.

```
┌───────────────────────────────────────────────────────────┐
│  INGENIERÍA                                             │
├───────────────────────────────────────────────────────────┤
│  Filtro: [Pendiente] [En proceso] [Documentado] [Todos]│
├───────────────────────────────────────────────────────────┤
│                                                         │
│  Cocina López                    ● Pendiente           │
│  Juan Pérez · Cotización #142 · Aceptada 12/08/2026   │
│  Ingeniería: — (sin asignar)                            │
│  [▶ Iniciar ingeniería]                                │
│  ───────────────────────────────────────────────────────  │
│  Placard Martínez               ● En proceso           │
│  María González · Cotización #138 · Aceptada 08/08   │
│  Ingeniería: Carlos R. · Iniciado: 10/08/2026          │
│  [▶ Continuar]                                         │
│  ───────────────────────────────────────────────────────  │
│  Cocina Rossi                    ● Documentado         │
│  Tomás R. · Cotización #130 · Aceptada 01/08          │
│  Ingeniería: María L. · Generado: 05/08/2026 · v2     │
│  [▶ Ver documentación]                                 │
└───────────────────────────────────────────────────────────┘
```

**Columnas / datos por proyecto:**

| Campo | Descripción |
|-------|-----------|
| Nombre proyecto | Nombre del proyecto/obra |
| Cliente | Nombre del cliente |
| Referencia | Número de cotización + fecha de aceptación |
| Estado ingeniería | `Pendiente` / `En proceso` / `Documentado` |
| Ingeniero asignado | Usuario que inició o último que tocó la ingeniería |
| Fecha inicio | Cuándo se inició la documentación |
| Fecha generación | Cuándo se generó el último pack de producción |
| Revisión | Número de versión del pack (v1, v2, ...) |

**Acciones por estado:**

| Estado | Botón | Acción |
|--------|-------|--------|
| Pendiente | `Iniciar ingeniería` | Registra usuario + fecha inicio, abre workspace |
| En proceso | `Continuar` | Abre workspace del proyecto |
| Documentado | `Ver documentación` | Abre workspace en modo consulta |

**Filtros:** `[Pendiente]` `[En proceso]` `[Documentado]` `[Todos]`

**Data source:** Proyectos con evento `deposit_received` registrado y sin `sent_to_production` (pendientes de ingeniería). Ver `docs/project-lifecycle.md`.

```ts
type EngineeringLog = {
  startedBy:           string;              // userId
  startedAt:           string;              // ISO datetime con hora
  generatedDocuments:  GeneratedDocuments;  // gate para habilitar enviar a producción
  sentToProductionBy:  string;              // userId
  sentToProductionAt:  string;              // ISO datetime con hora
  revision:            number;              // 1, 2, 3...
};
```

Ver tipos completos en `docs/project-lifecycle.md §3–4`.

| Campo | Cuándo se registra |
|-------|--------------------|
| `startedBy` / `startedAt` | Al hacer click en "Iniciar ingeniería" |
| `generatedBy` / `generatedAt` | Al descargar el pack ZIP o cualquier doc del tab Documentos |
| `sentToProductionBy` / `sentToProductionAt` | Al hacer click en "Marcar en producción" (con hora exacta) |
| `revision` | Sube con cada nueva generación del pack |

---

### 3.2 Workspace del proyecto (tabs)

Al hacer click en un proyecto, se abre el workspace de documentación para ese proyecto específico con los 6 tabs.

---

## 4. Tabs detail

### Tab: Resumen

**Purpose:** El ingeniero valida que el proyecto esté correcto y tiene visibilidad completa de los materiales necesarios. Esta información es la **fuente de verdad** que luego se pasa a Compras/Almacén como lista de pedido.

```
┌─────────────────────────────────────────────────────────┐
│  Resumen: Cocina López                                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ 12 módulos│ │ 84 piezas│ │  6 planchas│ │ 42 ml  │   │
│  │  (36 und) │ │ tablero  │ │ tablero  │ │ canto    │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│                                                         │
│  Materiales necesarios (lista para Compras/Almacén):   │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Tablero MDF 15mm  · 4 planchas  (post-optimiz.) │    │
│  │ Tablero MDF 18mm  · 2 planchas  (post-optimiz.) │    │
│  │ Canto ABS 22mm    · 28 ml                        │    │
│  │ Herrajes: 12 bisagras 35mm, 6 tiradores 128mm   │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  Listo para cortar:                                     │
│  ✅ Despiece de corte válido                            │
│  ✅ 84 piezas de tablero                                │
│  ✅ Optimizer generado (4 planchas MDF15 + 2 MDF18)    │
│  ⚠ Layout de cocina tiene items sin placement           │
└─────────────────────────────────────────────────────────┘
```

**Content:**
- Module count (lines + units)
- Piece count (from cut rows)
- **Board quantity in sheets/panels** (not m² — derived from cut optimization after running Optimizer)
- Edge banding length (ml)
- Complete material list: tableros + cantos + herrajes (what engineering passes to Compras/Almacén)
- Readiness checklist (same as current `buildProductionOrderReadiness`)

**Nota clave:** La cantidad de tableros se expresa en **planchas/hojas** (no en m²). Este número es el resultado de la optimización de corte y es lo que Compras/Almacén necesita para preparar el pedido o despacho.

**Data source:** Reuses `summarizeProductionTotals()`, `buildProductionOrderReadiness()`, `generateHardwareList()`.

---

### Tab: Despiece *(consulta y verificación — no es el flujo principal)*

**Purpose:** El ingeniero puede consultar el despiece completo en caso de dudas sobre piezas específicas. **No es el tab de trabajo principal** — la mayor parte del trabajo técnico pasa en Optimización. También sirve para imprimir el listado de piezas en A4 para producción si lo necesitan.

```
┌─────────────────────────────────────────────────────────┐
│  Despiece: Cocina López                   84 piezas     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Filtro: [Todos] [MDF 15mm] [MDF 18] [Melamina]        │
│                                                         │
│  # │ Pieza    │ Material     │ Ancho │ Alto │ Canto     │
│  ──┼──────────┼──────────────┼───────┼──────┼───────────│
│  1 │ P-001    │ MDF 15mm     │ 600   │ 400  │ ABS 22   │
│  2 │ P-002    │ MDF 15mm     │ 800   │ 350  │ —        │
│  3 │ P-003    │ Melamina 18  │ 1200  │ 600  │ ABS 22   │
│  ...                                                     │
│                                                         │
│  [▶ Imprimir en A4]   [▶ Exportar CSV]                 │
└─────────────────────────────────────────────────────────┘
```

**Content:**
- Full cut list with piece ID, material, dimensions, edge banding
- Filter by material type
- **Print A4** — hoja de despiece imprimible en papel A4 estándar para que producción tenga referencia física si la necesita
- Export CSV (para casos especiales)

**Quién imprime:**
- Ingeniería puede imprimirlo/exportarlo aquí
- Fábrica también puede imprimirlo en A4 desde su pantalla (se incluye el acceso de solo lectura + impresión)
- **No son etiquetas** — es un reporte de piezas en hoja A4

**Data source:** Reuses `generateCutRows()`, `ProductionCutRow[]`.

---

### Tab: Módulos

**Purpose:** Lista de módulos del proyecto con su estado de piso y ubicación. Permite al ingeniero verificar qué módulos conforman el proyecto y su avance actual en fábrica.

```
┌─────────────────────────────────────────────────────────┐
│  Módulos: Cocina López              Ambiente: [Todo ▾]│
├─────────────────────────────────────────────────────────┤
│                                                         │
│  # │ Módulo        │ Cant. │ Estado piso │ Ubicación   │
│  ──┼───────────────┼───────┼─────────────┼─────────────│
│   1 │ MDF-15-BASE   │   4   │ Pendiente   │ Cocina      │
│   2 │ MDF-15-MURO   │   2   │ Cortado     │ Cocina      │
│   3 │ MDF-18-ALTO   │   3   │ Encintado   │ Cocina      │
│  ...                                                     │
│                                                         │
│  [▶ Abrir diseñador]                                    │
└─────────────────────────────────────────────────────────┘
```

**Content:**
- Tabla de módulos con cantidad y estado de piso actual
- Filtro por ambiente (para cocinas multi-espacio)
- Link para abrir el diseñador en modo verificación

**Data source:** Reuses `projectScopedToProductionSpace()`, `listProductionSpaceOptions()`.

---

### Tab: Vistas

**Purpose:** Visual verification — elevations and 3D preview.

```
┌─────────────────────────────────────────────────────────┐
│  Vistas: Cocina López                                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  [Elevaciones] [Preview 3D]                             │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │                                                 │    │
│  │         Elevación del muro norte                │    │
│  │         (PDF preview or 3D render)              │    │
│  │                                                 │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  [▶ Exportar elevaciones PDF]                           │
└─────────────────────────────────────────────────────────┘
```

**Content:**
- Elevations per wall (PDF preview)
- 3D preview of the kitchen layout
- Export button for elevations PDF

**Data source:** Reuses `buildProductionElevations()`, `Module3DCatalogInput`.

---

### Tab: Optimización *(tab principal del ingeniero)*

**Purpose:** El tab donde el ingeniero define los tableros y genera los outputs técnicos de corte. La cantidad de tableros en planchas es el resultado calculado aquí y es la base para Compras/Almacén.

```
┌─────────────────────────────────────────────────────────┐
│  Optimización: Cocina López                             │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Tipo de corte: [Sierra] [CNC Nesting]                   │
│  (sierra → kerf + refilados; nesting → espaciado fresa)  │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Optimizer (Excel)                               │    │
│  │ Plantilla_Optimizer.xlsx                        │    │
│  │ Define tableros: 4 planchas MDF15 + 2 MDF18     │    │
│  │ [▶ Generar Optimizer]                           │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Cut-list CSV                                    │    │
│  │ CSV genérico (separador ;) para sierra/CNC      │    │
│  │ [▶ Generar CSV] [▶ Configurar CSV]             │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Nesting                                         │    │
│  │ Importar nesting real desde archivo externo     │    │
│  │ [▶ Importar nesting]                            │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ CNC                                             │    │
│  │ Perforaciones (JSON) + CNC pilot (JSON)         │    │
│  │ [▶ Descargar perforaciones] [▶ Descargar CNC]  │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ DXF Nesting (solo modo CNC, F124–F126)          │    │
│  │ Tableros nesteados o piezas sueltas (DXF R12)   │    │
│  │ [▶ Descargar DXF (tableros)] [▶ DXF (piezas)]   │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

**Content:**
- **Tipo de corte (F126)** — sierra guillotina o CNC nesting antes de generar; el área de export muestra solo las salidas del modo elegido (sierra → PDF + Optimizer XLSX; nesting → DXF).
- **Optimizer export (Excel)** — el output principal. Define cuántas planchas de cada tablero se necesitan. Este número (en planchas) es lo que va al Resumen y a Compras/Almacén.
- CSV export (configurable separator/preset) para sierra o CNC
- Nesting import (nesting real desde software externo)
- CNC exports (drilling JSON, CNC pilot JSON)
- DXF nesting export (R12, tableros nesteados o piezas sueltas — exclusivo del modo CNC)

**Flujo típico del ingeniero en este tab:**
1. Elegir tipo de corte (sierra o CNC nesting) y generar el plan 2D
2. Verificar en Resumen que los totales cuadran
3. Si hay correcciones, editar el diseño → volver a generar
4. Cuando está correcto → exportar lo pertinente al modo (XLSX/PDF o DXF) e ir a Documentos por el pack

**Data source:** Reuses `onExportOptimizer`, `onExportCutListCsv`, `onImportNesting`, `onExportCncPilot`, `downloadDrillingJson`, `onExportCutPlanDxf`.

---

### Tab: Documentos

**Purpose:** Complete documentation package — all downloads in one place.

```
┌─────────────────────────────────────────────────────────┐
│  Documentos: Cocina López                    OP rev. 3  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Pack de producción (ZIP)                               │
│  Optimizer + herrajes + etiquetas + elevaciones + ...   │
│  [▶ Descargar pack]                                    │
│                                                         │
│  ─────────────────────────────────────────────────────  │
│                                                         │
│  Documentos individuales:                               │
│                                                         │
│  ✅ Optimizer (Excel)              [▶ Descargar]        │
│  ✅ Cut-list CSV                   [▶ Descargar]        │
│  ✅ Lista herrajes (Excel)         [▶ Descargar]        │
│  ✅ Etiquetas pieza (PDF)          [▶ Descargar]        │
│  ✅ Etiquetas térmicas (ZPL)       [▶ Configurar]       │
│  ✅ Etiquetas módulo (PDF)         [▶ Descargar]        │
│  ✅ Elevaciones (PDF)              [▶ Descargar]        │
│  ✅ Hojas de armado (PDF)          [▶ Descargar]        │
│  ✅ Perforaciones (JSON)           [▶ Descargar]        │
│  ✅ CNC pilot (JSON)              [▶ Descargar]        │
│  ✅ Despiece (ver tab)             [▶ Ver]              │
│                                                         │
│  ─────────────────────────────────────────────────────  │
│                                                         │
│  ✓ Marcar en producción  (accepted → produced)          │
└─────────────────────────────────────────────────────────┘
```

**Content:**
- Pack ZIP button (all docs together)
- Individual download buttons for each document type
- "Mark as produced" button (status transition)

**Data source:** Reuses all `onExport*` callbacks from `ProductionOrderHub`.

---

## 5. Key design decisions

### 5.1 Ingeniería define, Fábrica ejecuta

El trabajo del ingeniero es:
1. Verificar que el diseño esté correcto (**Resumen**, **Vistas**)
2. Definir y confirmar los tableros necesarios en **Optimización** (en planchas, no m²)
3. Consultar el despiece en detalle si hay dudas (**Despiece** — uso ocasional)
4. Generar toda la documentación de fábrica (**Documentos**)
5. Empaquetar y marcar como producido

Una vez que el ingeniero marca "Marcar en producción", el proyecto entra en la cola de fábrica donde los operadores lo trabajan.

### 5.2 Etiquetas: generación en Ingeniería, impresión en cualquier punto

Las etiquetas (pieza, módulo, ZPL) y la lista de herrajes se **generan** desde los datos del diseño en Ingeniería.

**Flujo de impresión de etiquetas:**
- PDF generado con el tamaño de etiqueta correcto — listo para imprimir directamente desde la app o desde el archivo
- Incluido en el pack ZIP de producción
- **Fábrica puede reimprimir** — el operador puede descargar/imprimir el PDF ya generado desde la pantalla de Fábrica sin regenerarlo (no genera, solo descarga lo que ya existe en el proyecto)
- ZPL para impresoras térmicas configurado y descargable desde Ingeniería

**Despiece en A4:**
- Imprimible en papel A4 estándar (no son etiquetas)
- Disponible desde Ingeniería (tab Despiece) y desde Fábrica (solo lectura + imprimir)
- Incluido opcionalmente en el pack ZIP

**Lista de herrajes:**
- Ingeniería genera → se guarda en el proyecto
- Compras/Almacén la ve como lista de picking, no como stock

### 5.3 Tableros en planchas, no en m²

La cantidad de tableros se expresa siempre en **planchas/hojas** (no en m²). Este número proviene del resultado del Optimizer, que calcula cuántas planchas completas se necesitan dado el plan de corte. Es el número que Compras/Almacén usa para preparar el material.

### 5.4 Sin gestión de stock

El sistema trabaja con **listados** (qué necesita cada proyecto), no con inventario real. Compras/Almacén ve las listas de necesidades por proyecto. La gestión de stock es una fase futura cuando todo el flujo base esté funcionando.

### 5.5 Scope filter

For multi-space kitchens (e.g., "Cocina" + "Estudio"), the Engineering screen has an "Ambiente" filter that scopes the views to one space. The Optimizer export always uses the full project (you can't cut half a kitchen).

---

## 6. Navigation

- **Nav item:** "Ingeniería" in the INGENIERÍA section (new item, separate from ABM)
- **Icon:** `FileCheck` (lucide)
- **Opens:** Project selector → then the tabbed workspace for the selected project
- **Visible when:** `roleCanAccessEngineeringNav(role)` returns true (admin, ingeniero)
