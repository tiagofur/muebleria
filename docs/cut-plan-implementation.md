# Plan: Plan de Corte Profesional

## Contexto actual

El sistema genera piezas de tablero (`ProductionCutRow`) pero el plan de corte es una lista plana sin optimización. El PDF actual (`cutPreviewPdfExport`) hace packing izq→der sin lógica de fases ni identificación clara de piezas.

## Objetivo

Un plan de corte digno de software industrial (Homag/SCM/Biesse) que el operador pueda seguir en el taller con confianza.

---

## Fase 1 — Mejora del PDF y UI actual (MVP inmediato)

**Sin cambiar el algoritmo de packing, mejorar la identificación de piezas.**

### 1.1 PDF con identificación de piezas

- Código de pieza (`partCode`) visible en cada rectángulo
- Nombre de pieza (`partName`) debajo del código
- Código de módulo (`moduleCode`) como prefijo
- Referencia de etiqueta (`labelRef`) para cruzar con QR
- Cantos marcados: flechas o líneas en los lados con `L1/L2/W1/W2 = 1`
- Dimensión写的 en cada pieza (L×A)
- Numeración secuencial por página

### 1.2 Firma del archivo

- Nombre: `{proyecto}-plano-{material}.pdf`
- Header: proyecto, cliente, fecha, total de tableros
- Footer: material, dimensiones de tabla, kerf, piezas por página

### 1.3 UI — Preview mejorado

- `ProductionBoardView`: mostrar `partCode` + `partName` en cada pieza
- Cantos: borde destacado en los lados con encintado
- Tooltip con detalles completos al hover
- Click en pieza → resalta en la lista del despiece

---

## Fase 2 — Algoritmo de optimización (Nesting)

### 2.1 Bin Packing 2D con restricciones

- Algoritmo: guillotine cut o strip packing
- Respetar dirección de veta (`grain: 0 | 1`)
- Kerf configurable (default 4mm)
- Márgenes de borde configurables
- Minimizar desperdicio (% de tabla usada)

### 2.2 Configuración del optimizador

Parámetros configurables por proyecto:
- `sheetWidthMm` / `sheetHeightMm` (default 2440×1830)
- `sawKerfMm` (default 4)
- `allowRotation` (default false — la veta lo impide)
- `grainRespect` (default strict)
- `marginMm` (default 0)

### 2.3 Output del optimizador

```ts
interface CutPlan {
  projectId: string;
  generatedAt: string;
  config: CutPlanConfig;
  sheets: CutPlanSheet[];
  stats: CutPlanStats;
}

interface CutPlanSheet {
  sheetIndex: number;
  materialCode: string;
  materialName: string;
  widthMm: number;
  heightMm: number;
  pieces: CutPlanPiece[];
  wastePercent: number;
}

interface CutPlanPiece {
  partCode: string;
  partName: string;
  moduleCode: string;
  labelRef: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  grain: 0 | 1;
  edges: { L1: boolean; L2: boolean; W1: boolean; W2: boolean };
  phase: number;
}

interface CutPlanStats {
  totalSheets: number;
  totalPieces: number;
  totalAreaM2: number;
  wastePercent: number;
  materialBreakdown: { materialCode: string; sheets: number; waste: number }[];
}
```

---

## Fase 3 — Fases de corte

### 3.1 Agrupación por fase

El plan se divide en fases secuenciales para el operador:
- Fase 1: Traseros (primero se cortan los más grandes)
- Fase 2: Laterales
- Fase 3: Frentes
- Fase 4: Estantes y tapas
- Fase 5: Piezas pequeñas

Cada fase =一组 de cortes en una tabla antes de girar o cambiar材料.

### 3.2 PDF con fases

- Cada fase = sección separada con título
- Instrucciones de corte: "Cortar 3 tiras de 600mm → cortar transversalmente"
- Indicador de giro de tabla cuando aplique
- Numeración de piezas por fase

---

## Fase 4 — Persistencia

### 4.1 Campo en Project

```ts
// packages/domain/src/types.ts
readonly cutPlan?: CutPlan;
```

### 4.2 Migración Go

```sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS cut_plan JSONB;
```

### 4.3 Cadena de persistencia

- `projectToApi` / `projectFromApi` → serializar `cut_plan`
- `projects.go` → SELECT/INSERT/UPDATE con `cut_plan`
- `projectStore` → acción `generateCutPlan` que guarda el resultado

### 4.4 Flujo

1. Ingeniero configura parámetros
2. Clickea "Generar plan de corte"
3. Se ejecuta el optimizador
4. Se guarda `cutPlan` en el proyecto (persiste)
5. Se genera el PDF
6. Al recargar, el plan sigue ahí

---

## Fase 5 — UI del plan de corte

### 5.1 Panel de configuración

Dentro de la pestaña Optimización:
- Inputs: kerf, dimensiones de tabla, veta
- Botón "Generar plan de corte"
- Botón "Exportar PDF"
- Botón "Exportar Excel (Optimizer)"

### 5.2 Vista del plan

- Lista de tableros generados
- Click en tablero → preview SVG con piezas
- Estadísticas: desperdicio total, piezas por material
- Badge de "plan guardado" cuando existe persistencia

---

## Orden de implementación

| Paso | Fase | Dependencias |
|------|------|-------------|
| 1 | 1.1-1.3 (PDF + UI mejorados) | Ninguna — mejora inmediata |
| 2 | 4.1-4.3 (Persistencia) | Ninguna — se puede hacer en paralelo |
| 3 | 2.1-2.3 (Algoritmo) | Requiere diseño del algoritmo |
| 4 | 3.1-3.2 (Fases) | Requiere Fase 2 |
| 5 | 5.1-5.2 (UI completa) | Requiere Fase 2 + 3 |

**Recomendación: empezar por Fase 1 (mejoras al PDF/UI) + Fase 4 (persistencia) en paralelo. Son independientes y dan valor inmediato.**
