# Roadmap — La app perfecta para carpinteros

> **Estado:** Plan estratégico vivo (2026-07-21)  
> **Rumbo decidido:** Híbrido **board-first** + **3D por rol** + **herramienta operativa de oficio**  
> **No es:** un clon de Promob/Cabinet Vision. Es una app web para carpinteros y
> pequeñas fábricas, con el modelo mental del taller (tablas, cortes, vetas) y
> la simplicidad de una herramienta bien hecha.  
> **Relación con docs existentes:** reemplaza la ambigüedad entre `docs/IDEAS/`
> (visión CAD/CAM 4-modos) y `docs/prd.md` (CRUD de taller). Toma lo mejor de
> ambos y define el rumbo. No deroga el PRD de producto (`docs/prd.md`); lo
> refina con una visión de UX más ambiciosa pero alcanzable.

---

## 1. Diagnóstico — por qué la app "se siente oficinesca"

El dolor no viene de features faltantes. Viene de **cómo están organizadas las
que ya existen**.

### 1.1 Lo que tenés y no sabías que tenías

| Capa | Estado | Dónde |
|---|---|---|
| Viewport 3D real (R3F + three + drei) | ✅ serio | `packages/ui/src/preview3d/FurnitureScene3D.tsx` (401 L) |
| Composición paramétrica (Structure + Component + fórmulas) | ✅ | `domain/types.ts`, `structures/versioning.ts` |
| `FurnitureType` (inferior/superior/alto) + `measureDefaults` | ✅ | `types.ts:184` |
| `ProjectItemPlacement` + `spatialPlacement.ts` | ✅ semilla | sembrado, sin editor UI |
| 13 pantallas con RBAC, 6 exports, paridad TS↔Go | ✅ | ver `progress/history.md` |

**Conclusión:** tenés el 70% de la materia prima. Falta **organizarla y
exponerla** como herramienta de oficio, no como admin.

### 1.2 Las 5 causas de la sensación "oficinesca"

1. **`App.tsx` = 2880 líneas** con estado global mal distribuido (31 `useCallback`).
   No hay store; el "shell delgado" se volvió el Dios de la app.
2. **`ProjectsScreen.tsx` = 2793 líneas** — lista + detalle + 7 modales + 3D +
   presentación + checklist en UN solo componente.
3. **3 editores paralelos (Modules/Structures/Components)** con patrón idéntico
   replicado a mano, sin abstraer. Cada edición = entrar y salir de un Modal LG
   con 5-6 tabs.
4. **El 3D es solo preview pasivo** — existe el viewport pero el usuario no
   manipula piezas ahí. Es "mirar", no "diseñar".
5. **Nada de stepper visual de progreso de proyecto** — un proyecto es una
   pila de cards + totales. No hay sensación de "avance" (diseño → presenta →
   produce).

### 1.3 La grieta entre visión y realidad

| Visión (`docs/IDEAS/`) | Realidad construida | Brecha |
|---|---|---|
| Modo 1 Habitación 2D (muros) | ❌ no existe editor | Falta canvas |
| Modo 2 Diseño paramétrico 3D | 🔧 solo preview pasivo | Falta interacción |
| Modo 3 Presentación | 🔧 overlay simple | Falta pulir + estilos |
| Modo 4 Producción (split BOM + corte) | 🔧 solo exports archivos | Falta vista interactive |
| 4 modos como stepper | ❌ | Falta UX de progreso |

**No vamos a clonar los 4 modos del PRD original.** Vamos a llevar la app
actual hacia una experiencia donde cada rol del taller sienta que su parte es
**una herramienta de oficio, no un formulario**.

---

## 2. Visión — qué es "la app perfecta" para vos

> **Norte:** Una app web donde un carpintero o vendedor técnico entra, y en 10
> minutos está diseñando un mueble moviendo tablas (no llenando celdas), viendo
> el costo en vivo, mostrando al cliente cómo queda, y entregando al taller un
> plan de corte claro. Sin curva de CAD. Sin SketchUp. Sin Excel.

### 2.1 Modelo mental: **board-first** (inspirado en SketchList 3D)

El cambio conceptual más importante. Hoy la unidad de edición es **la fila de
una tabla en un modal**. Tiene que ser **la tabla de madera como objeto
manipulable**.

```
HOY (CRUD-oficinesco)              MAÑANA (board-first)
┌─────────────────────┐            ┌──────────────────────────┐
│ Modal "Editar Mod"  │            │ Canvas de tablas          │
│  Tab "Piezas"       │            │  ┌──┐ ┌────┐ ┌──┐        │
│   Tabla:            │   ─────►   │  │C │ │ P  │ │R │ (3D iso)│
│   • Costado I 720   │            │  └──┘ └────┘ └──┘        │
│   • Piso 564        │            │                            │
│   • Repisa 700      │            │  Click tabla → panel props │
│   [+ Agregar fila]  │            │  (espesor/largo/veta/rol)  │
└─────────────────────┘            └──────────────────────────┘
```

- Cada `BoardPart` se vuelve **una pieza visual** con thickness, length, width,
  grain direction, material-role, edges.
- Se arrastra, se rota (para hornear veta), se duplica.
- El despiece (BOM) se **calcula desde el canvas**, no se ingresa a mano.
- Click en una tabla → panel de propiedades contextual (drawer derecho, 360px).

### 2.2 Por qué board-first y no "clon Promob"

| App | Modelo | Por qué no vos |
|---|---|---|
| Promob / Cabinet Vision | Catálogo rígido de módulos + render fotorrealista | Caro, desktop, curva alta, xml de marca |
| Gabster / Dinabox | Plugin sobre SketchUp | Rehén de Trimble; dependencia externa |
| Polyboard | Paramétrico puro desktop | Cercano pero desktop y opaco |
| SketchList 3D | **Board-oriented**, simple, accessible | **Modelo mental correcto**, pero desktop Win, render débil |
| **Vos** | **Board-first + catálogo + 3D por rol, web nativo** | Hueco del mercado |

**Ventaja estructural:** web nativa, multi-usuario (Go backend ya existe),
pricing transparente, compartir por link. Ninguna de las brasileras hace esto bien.

### 2.3 3D por rol (no un solo 3D para todos)

Cada rol del taller ve la cantidad justa de 3D:

| Rol | Su 3D | Modo |
|---|---|---|
| **Vendedor** | Showcase (vitrina) + presentación con renders simples | "Mirá cómo quedaría tu cocina" |
| **Ingeniero / Diseñador** | Editor paramétrico: manipular tablas, ver cotas, snapping | "Diseño la pieza" |
| **Producción** | Cut list 2D + planos de tablero, no 3D | "¿Cómo corto esto?" |
| **Cliente** (link compartido) | Solo presentación, sin costos, sin BOM | "Aprobá esto" |

---

## 3. Las 5 decisiones estratégicas

Estas son las decisiones que estructuran todo el roadmap. **Confirmalas antes
de empezar la Fase 0** (ver §7).

### D1 — Adoptar modelo board-first como norte de UX

La unidad de trabajo del ingeniero pasa de "fila de tabla en modal" a
"tabla de madera manipulable en canvas". No se borra la grilla (sigue para
lectura y administración), pero **el editor principal es visual**.

### D2 — 3 capas de visualización, no 1

| Capa | Para qué | Estado |
|---|---|---|
| **2D plano de cocina** (muros + placements) | Diseño espacial del proyecto | Semilla en `ProjectItemPlacement` |
| **Editor de mueble** (canvas 2D isométrico + 3D opcional) | Diseño de la pieza (board-first) | Tablas hoy en modal |
| **Vista 3D de presentación** (ya existe R3F) | Vender al cliente | `FurnitureScene3D` |

Las 3 conviven y se alimentan del mismo `ResolvedBom`.

### D3 — Stepper de proyecto como columna vertebral de UX

Hoy un proyecto es una pila. Tiene que ser un **progreso visible**:

```
[1. Módulos] → [2. Plano] → [3. Presentación] → [4. Producción]
   ✓ agregados  ✓ ubicados   ✓ aprobado         ✓ exportado
```

Cada paso habilita el siguiente. El usuario **ve** dónde está. (No es un
wizard que oculta; es una breadcrumbs de estado.)

### D4 — Refactor arquitectura antes de features

No se puede poner un canvas 3D arriba de `App.tsx` de 2880 líneas. Primero
**separa estado en stores (Zustand)**, **parte las screens gigantes** y
**abstrae el EntityEditorLayout común**. Es deuda técnica que se paga sola.

### D5 — No más "Modal LG con 6 tabs" como editor

El editor de Modules / Structures / Components hoy es un modal gigante.
Pasa a ser **vista detalle inline con canvas lateral** (ya hay patrón
establecido en `/modules/:id/edit`). El canvas de tablas reemplaza al
tab "Piezas".

---

## 4. Arquitectura objetivo (alto nivel)

### 4.1 Stores Zustand (reemplazan estado en App.tsx)

```
projectStore          — proyecto activo + draft + undo/redo
catalogStore          — materiales/cantos/herrajes/grupos (cache + invalidation)
workspaceStore        — workspace + sesión + RBAC
editorStore           — estado del editor de mueble (selected board, tool, snap)
uiStore               — toasts, modales, command palette, theme
```

### 4.2 Capas de visualización

```
EditorCanvas (board-first)
├── 2D isométrico por defecto (rápido, claro, molde de taller)
├── 3D opcional (R3F existente, mismo motor)
└── Lectura/escritura de Module.boardParts via editorStore

KitchenCanvas (plano de cocina) — NUEVO
├── Muros (Wall[], segmentos 2D)
├── Placements (ProjectItemPlacement sobre muro)
├── Snapping a muro y a otros muebles
└── Export → 3D de presentación

PresentationView (R3F existente, pulido)
└── Sin cotas, sin rejilla, estilos globales, explosionada
```

### 4.3 Comando + Undo/Redo (PRD §4.3)

Toda mutación al proyecto/canvas pasa por un `Command`:

```ts
interface Command { execute(): void; undo(): void; describe(): string }
```

Stack de 50 (configurable). Atajos `Cmd+Z` / `Cmd+Shift+Z`. Es lo que hace
sentir la app como "herramienta" y no como "formulario".

---

## 5. Roadmap por fases

Cada fase entrega valor autónomo. Ninguna fase depende de la siguiente para
ser útil. **Una fase = varias features atómicas en `feature_list.json`.**

### Fase 0 — Deuda técnica (2-3 semanas)

**Objetivo:** dejar una base sana antes de construir canvas encima.

| Slice | Qué | Por qué |
|---|---|---|
| 0.1 | Partir `App.tsx` en stores Zustand + componentes | Hoy es inmanejable |
| 0.2 | Partir `ProjectsScreen.tsx` en `ProjectsListScreen` + `ProjectDetailScreen` + `ProjectExportsPanel` | Frankenstein |
| 0.3 | Extraer `EntityEditorLayout<Tab,Draft>` común (Modules/Structures/Components comparten molde) | 3 codebases → 1 |
| 0.4 | `engine.ts` (2108 L): partir por responsabilidades (resolution / pricing / cut / hardware / validate) | Monolito |
| 0.5 | Command pattern básico (undo/redo) sobre mutaciones de proyecto | Base para canvas |

**Criterio de salida:** App.tsx < 600 líneas, screens < 600 L, no hay regression visual o de tests.

### Fase 1 — Board-first editor (4-6 semanas) — EL CORAZÓN

**Objetivo:** el ingeniero diseña un mueble manipulando tablas, no llenando
filas. Es el momento donde la app "deja de ser oficinesca".

| Slice | Qué |
|---|---|
| 1.1 | `BoardCanvas` 2D isométrico (sin R3F todavía) —拖/rotate/snap de tablas |
| 1.2 | Panel de propiedades contextual (drawer derecho) — thickness/length/width/grain/edges/role |
| 1.3 | Sincro bidireccional canvas ↔ `Module.boardParts` via editorStore |
| 1.4 | Snapping: cuadrícula, align a otra pieza, alinear a borde del mueble |
| 1.5 | Reemplazar tab "Piezas" del ModuleEditorForm por el canvas (grilla sigue como toggle) |
| 1.6 | Costo en vivo (m², ML canto, $) actualizado al mover/redimensionar |
| 1.7 | Modo 3D opcional del mismo canvas (R3F ya existente) |
| 1.8 | Atajos de teclado (d=duplicate, r=rotate, del=remove, v=toggle veta) |

**Criterio de salida:** crear un gabinete 1-puerta desde cero en < 2 minutos
sin tocar una sola fila de tabla.

### Fase 2 — Plano de cocina (3-4 semanas)

**Objetivo:** el vendedor/ingeniero arma la cocina del cliente en planta.

| Slice | Qué |
|---|---|
| 2.1 | `KitchenCanvas` 2D: dibujo de muros (segmentos con largo mm) |
| 2.2 | Colocar items de la cotización sobre muro (arrastrar desde lista lateral) |
| 2.3 | Snapping a muro + a otro mueble + elevation automática (piso vs alto) |
| 2.4 | Reordenar a lo largo del muro (drag, flechas) |
| 2.5 | Validaciones blandas (solape, sobresale del muro) — warnings, no bloqueos |
| 2.6 | Vista 3D del proyecto **leyendo placements** (reemplaza `layoutProjectRun`) |
| 2.7 | Persistencia placements (API + localStorage) |

**Criterio de salida:** armar una cocina en L de 4 muros con 6 muebles en < 10 min.

### Fase 3 — Presentación al cliente + vitrina (2-3 semanas)

**Objetivo:** cerrar la venta visualmente. Pulir lo que ya existe.

| Slice | Qué |
|---|---|
| 3.1 | Modo presentación fullscreen pulido (sin chrome de taller) |
| 3.2 | Vista explosionada con slider |
| 3.3 | Aplicador de estilos globales (cambiar acabado en un click) |
| 3.4 | Vitrina con mejor render (foto + descripción + dimensiones) |
| 3.5 | Export captura PNG / PDF de la vista 3D para enviar al cliente |
| 3.6 | Link compartido (cliente ve presentación sin login, sin costos) |

**Criterio de salida:** una sesión de venta en la que el cliente aprueba con el render adelante.

### Fase 4 — Producción como vista interactiva (3-4 semanas)

**Objetivo:** el taller entra y ve "cómo cortar esto", no un Excel.

| Slice | Qué |
|---|---|
| 4.1 | `ProductionScreen` real: split BOM (izq) + plan de tablero (der) |
| 4.2 | Plan de tablero visual (SVG/canvas): piezas acomodadas sobre 2440×1220 |
| 4.3 | Estimación de pliegos (m² / pliego catálogo) ya en domain |
| 4.4 | Etiquetas con QR (#141) |
| 4.5 | Pack producción ZIP (un click) — ya hay builder, faltaría pulir UX |
| 4.6 | Vista móvil-friendly para usar parado frente a la sierra |

**Criterio de salida:** el operario de sierra entra con su tablet y tiene todo sin imprimir nada.

### Fase 5 — Inteligencia de taller (ongoing)

Esto es backlog más largo, se acomoda por demanda real:

- Reglas de taller (bisagras por alto, correderas por fondo) — PRD §Fase 4
- Comparar escenarios A/B (#137, ya hay semilla)
- Plantillas de cocina (#110, hecho pero falta integrar con plano)
- Import resultado nesting real (#142)
- DXF opcional por pieza (#111, doc only hasta demanda)
- Multi-moneda, calendarización, etc.

---

## 6. Priorización por valor vs esfuerzo

| Fase | Valor taller | Valor venta | Esfuerzo | Recomendación |
|---|:---:|:---:|:---:|---|
| 0 Deuda | medio | — | medio | **Sí, primero** — sin esto no se puede construir bien |
| 1 Board-first | alto | bajo | alto | **Sí, crítico** — es la transformación de identidad |
| 2 Plano cocina | medio | alto | medio | **Sí, después** — desbloquea venta visual |
| 3 Presentación | bajo | alto | bajo | **Sí, pulir lo existente** |
| 4 Producción interactiva | alto | — | medio | Cuando el taller empiece a usar la app en serio |
| 5 Inteligencia | medio | medio | varía | Por demanda |

**Camino mínimo viable para sentir el cambio:** Fase 0 + Fase 1. Es donde la
app deja de sentirse "oficinesca" y pasa a sentirse "de oficio".

---

## 7. Lo que necesito que confirmes antes de empezar

Estas son las decisiones que no puedo tomar solo (§3). Marcá cuáles sí / no /
ajustar:

- [ ] **D1 board-first** como norte de UX (es la apuesta más grande)
- [ ] **D2 tres capas** de visualización (no una)
- [ ] **D3 stepper de proyecto** visible
- [ ] **D4 refactor arquitectura primero** (Fase 0 antes que features)
- [ ] **D5 no más Modales LG** para edición compleja

Y una decisión de producto más:

- [ ] **¿Cuánto tiempo podés invertir por semana?** (define si esto es 3 meses
      o 9 meses). Lo razonable: Fases 0-1 en 2 meses si hay foco.

---

## 8. Anti-scope (qué NO vamos a hacer)

Para mantener el foco:

- ❌ Render fotorrealista / PBR / path tracing
- ❌ CAD libre (líneas, splines, escultura)
- ❌ Importación automática de planos DXF/PDF a muros
- ❌ Post-procesadores CNC de marca (Quaza, Biesse, Morbidelli) hasta demanda real
- ❌ ERP completo (stock, compras, facturación electrónica)
- ❌ Multi-empresa / SaaS con billing (todavía)
- ❌ Mobile nativa (web responsive basta)
- ❌ Colaboración real-time multi-usuario simultáneo (estilo Figma)

---

## 9. Cómo medimos que funcionó

| Métrica | Hoy | Meta (post Fase 1) | Meta (post Fase 4) |
|---|---|---|---|
| Tiempo diseñar mueble nuevo | ~10-15 min (tabs + filas) | < 3 min (canvas) | < 3 min |
| Tiempo armar cotización 6 muebles | ~20 min | ~15 min | ~10 min (con plano) |
| Clicks para exportar Optimizer | 3-4 | 1 | 1 (pack ZIP) |
% de sesiones donde se usa 3D | bajo | medio | alto |
% Clientes que aprueban con render | bajo | medio | alto |
| Líneas de App.tsx | 2880 | < 600 | < 600 |
| "Se siente herramienta" (subjetivo) | no | sí | sí |

---

## 10. Próximo paso concreto

Si aprobás este roadmap:

1. **Confirmás D1-D5** (§7).
2. Decidimos juntos **cuál es el primer slice** (recomiendo Fase 0.1: Zustand
   stores + partir App.tsx — sin esto nada construido arriba va a ser mantenible).
3. Lo implementamos como feature atómica en `feature_list.json` con tests.
4. Cerramos, push a origin, avanzamos al siguiente slice.

Si NO aprobás algo: lo ajustamos antes de escribir código.

---

## 11. Referencias

- `docs/IDEAS/PRD.md` — visión original CAD/CAM 4-modos
- `docs/prd.md` — PRD actual (CRUD de taller)
- `docs/app-excellence.md` — plan post-horizonte (#125-#142)
- `docs/IDEAS/design.md` — design tokens del CAD (revisar cuáles traer)
- `packages/ui/src/preview3d/` — el 3D que ya tenés
- `packages/domain/src/types.ts` — entidades (FurnitureType, ProjectItemPlacement, Component)
- Investigación comparativa: Promob / Gabster / Dinabox / Polyboard / SketchList 3D
  (archivo de contexto de sesión, pedir si se necesita re-leer)
