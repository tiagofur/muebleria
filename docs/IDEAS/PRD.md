# Product Requirement Document (PRD)

**Aplicación Web CAD/CAM Paramétrica para Diseño y Fabricación de Muebles**

> **Cómo leer este documento (obligatorio para agentes)**  
> 1. Primero: [`docs/product-map.md`](docs/product-map.md) — mapa mental (módulos de app ≠ modos de diseño).  
> 2. Luego: este PRD para **visión de producto**, **fórmulas** y **contratos de datos**.  
> 3. Orden de implementación: [`docs/roadmap.md`](docs/roadmap.md) (no el §6 histórico a ciegas).  
> 4. Tareas atómicas: `feature_list.json`.  
> 5. `docs/ideas.md` es **inspiración**, no spec de stack ni checklist de sprint.
>
> **Estado del producto (2026-07)**: el monorepo ya tiene motor de despiece, BOM,
> nesting, catálogos, clientes/proyectos y precios. La UI actual es de **taller**
> (Ingeniería | Presupuestos | Producción), no el canvas 3D de 4 modos. Los 4
> modos de este PRD son la **visión de diseño espacial** dentro de un proyecto.

---

## 0. Módulos de aplicación vs 4 modos de diseño

Hay dos estructuras de producto. **No son intercambiables.**

| Estructura | Qué es | Dónde vive hoy |
|------------|--------|----------------|
| **Módulos de app** (shell) | Navegación global del taller: Ingeniería (catálogos), Presupuestos (comercial), Producción (taller) | `apps/web` sidebar |
| **4 modos de diseño** | Flujo CAD dentro de un **proyecto**: Habitación → Diseño → Presentación → Producción | Visión PRD §2; parcialmente cubierto por formulario + ProductionScreen |

- Catálogos y clientes **no** son “Modo 1”.  
- El Modo 4 (producción CAM) **reutiliza** el mismo motor que el módulo Producción.  
- Detalle y anti-patrones: `docs/product-map.md`.

---

1. Visión General del Producto

1.1 Contexto y Propósito

El software actual de diseño de interiores suele dividirse en dos mundos disconexos:

Software Visual (Comercial): Rápido y estético para vender al cliente, pero sin precisión técnica para la fabricación.

Software Técnico (Taller/CAD): Preciso y parametrizado para producción, pero con interfaces obsoletas, curvas de aprendizaje pronunciadas y altos costos de licencia.

Este proyecto tiene como objetivo unificar ambos mundos mediante una aplicación web moderna, intuitiva, responsiva y sumamente potente. Permitirá diseñar cocinas y clósets paramétricos en tiempo real frente al cliente, cotizar de inmediato y generar, con un solo clic, el desglose milimétrico de piezas (BOM), planos de corte optimizados en PDF y archivos DXF listos para maquinaria CNC.

1.2 Objetivos Estratégicos

Intuición: Reducir la carga cognitiva mediante un flujo de trabajo lineal guiado (4 Modos).

Rendimiento: Mantener una tasa de refresco constante en el motor 3D ($> 60\text{ FPS}$) usando un estado desacoplado de la interfaz de usuario.

Precisión de Ingeniería: Lógica paramétrica estricta basada en el espesor del material ($T$), holguras de ensamble y orientación de vetas.

Independencia de Maquinaria: Capacidad de exportar tanto para corte manual (PDF optimizado) como para fabricación automatizada (DXF estructurado).

2. Flujo de Usuario y UI/UX (El Sistema de 4 Modos)

> **Alcance de esta sección**: describe el flujo **dentro de un proyecto de
> diseño** (Eje B). La app también tiene módulos de catálogo y comercial fuera
> de este stepper; ver §0 y `docs/product-map.md`.
>
> **Hoy**: no hay stepper de 4 modos en UI. El valor equivalente se reparte en
> formularios paramétricos (Presupuestos/Producción) hasta el Horizonte C/D del
> roadmap.

Para evitar la saturación de botones y herramientas en la pantalla, la interfaz de **diseño de proyecto** se dividirá en cuatro espacios de trabajo especializados que representan el progreso lógico del diseño.

┌────────────────────────────────────────────────────────────────────────┐
│                        FLUJO DE TRABAJO EN 4 PASOS                     │
├───────────────┬──────────────────────┬────────────────┬────────────────┤
│ 1. HABITACIÓN │ 2. DISEÑO PARAMÉTRICO│ 3. PRESENTACIÓN│ 4. PRODUCCIÓN  │
│ Muros, tomas  │ Catálogo, Snapping,  │ Texturas PBR,  │ Despiece,      │
│ de agua, gas  │ Modificación Cotas   │ Cotizaciones   │ Nesting, DXF   │
└───────────────┴──────────────────────┴────────────────┴────────────────┘


Modo 1: Configuración de la Habitación (Planimetría)

Objetivo: Definir el contenedor físico donde se instalarán los muebles.

Vista: Planta 2D ortogonal por defecto, con opción de previsualizar en 3D.

Funciones clave:

Dibujo paramétrico de muros (Largo, Grosor, Altura).

Arrastrar e insertar obstáculos o referencias fijas: Puertas, Ventanas, Columnas, Tomas de Agua, Tomas de Gas, Tomacorrientes.

Snapping de obstáculos a los muros.

Modo 2: Diseño Paramétrico 3D (Configurador)

Objetivo: Ensamblar la distribución de los muebles rápidamente.

Vista: Perspectiva 3D con rejilla técnica de ayuda, cotas visibles y gizmos de transformación.

Funciones clave:

Catálogo Lateral: Categorizado por tipología (Módulos Bajos, Módulos Altos, Torres, Cajoneras, Clósets).

Snapping Inteligente: Al arrastrar un mueble cerca de un muro o de otro mueble, este debe "imanarse" de forma automática lateralmente y a nivel de piso.

Panel de Propiedades Contextual (Derecha): Al hacer clic en un mueble, se despliegan sus parámetros específicos:

Globales: Ancho ($W$), Alto ($H$), Profundidad ($D$).

Internos: Número de repisas, cantidad de cajones, orientación de apertura de puerta.

Construcción: Espesor del tablero ($T$), retiro de zócalo, holgura de frentes.

Modo 3: Presentación al Cliente (Comercial)

Objetivo: Convencer al cliente visualmente y cerrar la venta.

Vista: 3D limpio. Se ocultan rejillas, cotas, herrajes de ensamble ocultos y gizmos. Sombras suaves activadas.

Funciones clave:

Aplicador de Estilos Globales: Cambiar el acabado de toda la cocina con un clic (ej. "Gris Grafito con Cubierta de Cuarzo Blanco").

Vista Explosionada Interactiva: Un control deslizante que separa las piezas del mueble en el espacio para mostrar los compartimentos internos al cliente de forma dinámica.

Generador de Presupuesto: Cálculo de precio al instante basado en metros cuadrados de material, cantidad de herrajes y tarifas de mano de obra configurables.

Modo 4: Producción y Preparación CAM (Taller)

Objetivo: Preparar la fabricación sin errores humanos.

Vista: Pantalla dividida en dos: a la izquierda, la lista detallada de piezas (BOM) y controles; a la derecha, la distribución en el plano de corte 2D.

Funciones clave:

Visualizador de Despiece: Tabla interactiva con identificación de piezas mediante código (ej. "M1_COST_IZQ" para Costado Izquierdo del Módulo 1).

Optimizador 2D: Muestra la simulación de acomodo de piezas en los tableros de melamina estándar.

Botones de Exportación: Descarga de PDF de corte, DXF para CNC y CSV de materiales.

3. Ingeniería del Mueble y Definición de Datos

Un mueble en esta aplicación no es un archivo 3D pre-diseñado (como un .OBJ o .FBX). Un mueble es un objeto matemático paramétrico que calcula su geometría y su despiece de manera dinámica en función de sus dimensiones exteriores.

3.1 Variables Dimensionales Base

Definimos los parámetros globales de un módulo de la siguiente manera:

$W$: Ancho exterior total.

$H$: Alto exterior total (incluyendo zócalo si aplica).

$D$: Profundidad exterior total (sin considerar frentes de puertas/cajones).

$T$: Espesor nominal de los tableros (ej. $15\text{ mm}$, $18\text{ mm}$).

$B$: Altura del zócalo/zócalo empotrado (ej. $100\text{ mm}$).

$g$: Holgura o junta perimetral para frentes y puertas (ej. $2\text{ mm}$).

3.2 Fórmulas de Despiece de un Gabinete Base Estándar (Ejemplo)

Para un módulo bajo de cocina con dos costados, un piso, dos amarres superiores, un fondo y una repisa intermedia móvil, el motor de cálculo matemático aplicará las siguientes ecuaciones de manera estrictamente interna:

┌────────────────────────────────────────────────────────┐
│               ESQUEMA DE ENSAMBLE GABINETE BASE        │
├────────────────────────────────────────────────────────┤
│                                                        │
│             ┌─────── AMARRE SUPERIOR ───────┐          │
│             │                               │          │
│       ┌─────┴─────┐                   ┌─────┴─────┐    │
│       │           │                   │           │    │
│       │           │◄──────REPISA─────►│           │    │
│       │  COSTADO  │                   │  COSTADO  │    │
│       │  IZQ (H)  │                   │  DER (H)  │    │
│       │           │   ┌───────────┐   │           │    │
│       │           ├───┤   PISO    ├───┤           │    │
│       └─────┬─────┘   └─────┬─────┘   └─────┬─────┘    │
│             │               │               │          │
│             └───────────────┴───────────────┘          │
│                       ZÓCALO (B)                       │
└────────────────────────────────────────────────────────┘


Costados ($2$ unidades - Izquierdo y Derecho):

$\text{Alto} = H - B$

$\text{Ancho} = D$

$\text{Espesor} = T$

Piso ($1$ unidad):

$\text{Alto} = W - (2 \times T)$

$\text{Ancho} = D$

$\text{Espesor} = T$

Amarres Superiores ($2$ unidades - Frontal y Posterior):

$\text{Alto} = W - (2 \times T)$

$\text{Ancho} = 80\text{ mm}$ (parámetro configurable)

$\text{Espesor} = T$

Repisa Móvil ($1$ unidad):

$\text{Alto} = W - (2 \times T) - 2\text{ mm}$ (tolerancia de deslizamiento)

$\text{Ancho} = D - 20\text{ mm}$ (retroceso para paso de puertas)

$\text{Espesor} = T$

Fondo del Mueble ($1$ unidad - MDF delgado, ej. $3\text{ mm}$):

Si es empotrado en ranura con un retroceso de $15\text{ mm}$ y ranura de $5\text{ mm}$ de profundidad:

$\text{Alto} = (H - B) - 2T + (2 \times 5\text{ mm})$

$\text{Ancho} = W - 2T + (2 \times 5\text{ mm})$

3.3 Gestión de Tapacantos (Bandeado de Bordes)

El despiece debe registrar qué bordes de cada pieza de melamina llevarán tapacantos para descontarlo del corte de la sierra y para agregarlo a la orden de compra de insumos.

Cada panel rectangular tiene 4 bordes: $L_1$ y $L_2$ (largo 1 y 2), $A_1$ y $A_2$ (ancho 1 y 2).

Para cada borde se define un estado binario o de grosor:

0: Sin tapacanto.

1: Tapacanto delgado ($0.45\text{ mm}$).

2: Tapacanto grueso ($2.0\text{ mm}$).

Compensación de Medida de Corte: El sistema calculará la medida final de corte de la sierra restando el grosor del tapacanto.


$$\text{Medida Sierra} = \text{Medida Nominal} - (\text{Cantidad de Tapacantos en ese eje} \times \text{Grosor del Tapacanto})$$

3.4 Sentido de Veta (Grain Direction)

Atributo obligatorio por tipo de panel (hasGrain: boolean).

Si el material tiene veta (como maderas texturizadas), la pieza no puede rotarse libremente en el optimizador de corte de melamina. El largo de la pieza debe alinearse estrictamente con el sentido de la veta del tablero maestro.

4. Arquitectura de Software y Modelo de Datos

Para que la aplicación permanezca escalable, es imperativo separar por completo la visualización en pantalla (el "actor" gráfico) de la lógica de negocio y cálculo (el "cerebro" matemático).

                                 ┌──────────────┐
                                 │  React / UI  │
                                 └──────┬───────┘
                                        │ (Envia acciones / Lee estado)
                                        ▼
                                ┌───────────────┐
                      ┌─────────┤ Zustand Store ├─────────┐
                      │         └───────────────┘         │
                      ▼                                   ▼
              ┌───────────────┐                   ┌───────────────┐
              │  Viewport 3D  │                   │ Engine Core / │
              │  (BabylonJS)  │                   │ Math Decouple │
              └───────────────┘                   └───────────────┘
                      │                                   │
             (Dibuja cajas 3D)                  (Cálculos de Despiece)


4.1 El Modelo de Datos de Proyecto (Esquema del JSON)

Un archivo de proyecto completo se representará mediante un único esquema JSON declarativo. Esto facilita guardar el proyecto en base de datos, compartirlo por enlace, o cargarlo localmente.

{
  "projectInfo": {
    "id": "proj_98231aef",
    "name": "Cocina Residencia López",
    "createdAt": "2026-07-20T17:45:00Z"
  },
  "settings": {
    "globalMaterialThickness": 18,
    "sawKerf": 4.2,
    "defaultEdgebandThickness": 1.0
  },
  "materials": [
    {
      "id": "mat_melamine_white",
      "name": "Blanco Frost",
      "type": "melamine",
      "thickness": 18,
      "sheetWidth": 2440,
      "sheetHeight": 1220,
      "hasGrain": false,
      "pricePerSheet": 45.0
    }
  ],
  "room": {
    "width": 4500,
    "height": 2600,
    "depth": 3000,
    "walls": [
      { "id": "wall_1", "start": [0,0], "end": [4500,0], "height": 2600 }
    ]
  },
  "modules": [
    {
      "id": "mod_sink_base",
      "type": "base_gabinete_puertas",
      "position": { "x": 1200, "y": 0, "z": 0 },
      "rotation": { "x": 0, "y": 0, "z": 0 },
      "dimensions": { "w": 900, "h": 750, "d": 580 },
      "parameters": {
        "materialId": "mat_melamine_white",
        "hasShelves": true,
        "shelfCount": 1,
        "toeKickHeight": 100,
        "toeKickDepth": 50
      }
    }
  ]
}


4.2 Arquitectura del Viewport 3D

No utilices wrappers declarativos de React/Vue que rendericen en base al estado del DOM virtual para todo. Se desarrollará una clase pura de TypeScript (Viewport3DManager) que mantenga un ciclo de renderizado optimizado directo sobre WebGL (a través de Babylon.js o Three.js).

class Viewport3DManager {
  private engine: BABYLON.Engine;
  private scene: BABYLON.Scene;
  private meshesMap: Map<string, BABYLON.Mesh> = new Map();

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new BABYLON.Engine(canvas, true);
    this.scene = new BABYLON.Scene(this.engine);
    this.initScene();
  }

  // Se ejecuta de manera limpia al actualizar el store del proyecto
  public syncScene(modulesData: ModuleJSON[]) {
    // 1. Identificar módulos añadidos, modificados o removidos.
    // 2. Modificar solo los meshes que sufrieron cambios en posición o tamaño físico.
    // 3. Re-instanciar las mallas que alteren su topología.
  }

  public enableSnapping() {
    // Habilitar detectores de distancia entre colisiones (AABB Bounding Boxes)
  }
}


4.3 Sistema de Historial robusto (Undo/Redo: Patrón Comando)

Para que el usuario pueda equivocarse y retroceder sin problemas en el diseño CAD:

Cada modificación del diseño se encapsula en una interfaz Command:

interface Command {
  execute(): void;
  undo(): void;
}


Por ejemplo, la acción de estirar un mueble:

class ResizeModuleCommand implements Command {
  constructor(
    private store: ProjectStore,
    private moduleId: string,
    private oldDims: Dimensions,
    private newDims: Dimensions
  ) {}

  execute() { this.store.updateDims(this.moduleId, this.newDims); }
  undo() { this.store.updateDims(this.moduleId, this.oldDims); }
}


El CommandManager mantendrá dos pilas de datos (Undo Stack y Redo Stack) con un límite configurado de 50 comandos para optimizar la memoria RAM del navegador.

5. El Motor de Despiece y Optimización 2D (CAM)

Uno de los mayores diferenciadores de la aplicación es su capacidad de calcular el Nesting o Anidado 2D de piezas de manera automatizada para maximizar el aprovechamiento de los tableros.

┌─────────────────────────────────────────────────────────────┐
│                    TABLERO DE MELAMINA                      │
├─────────────────────────────────────────────────────────────┤
│ ┌───────────────┐ ┌─────────────────┐ ┌───────────────────┐ │
│ │  COSTADO IZQ  │ │   COSTADO DER   │ │       PISO        │ │
│ │               │ │                 │ │                   │ │
│ └───────────────┘ └─────────────────┘ └───────────────────┘ │
│ ┌───────────┐ ┌─────────────────┐                           │
│ │  REPISA   │ │    FRENTES      │    ÁREA LIBRE             │
│ │           │ │                 │                           │
│ └───────────┘ └─────────────────┘                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘


5.1 El Algoritmo de Empaquetado en Tablero (Bin Packing)

Ubicación de cálculo: El procesamiento pesado de optimización matemática se delegará a un Web Worker en segundo plano. Esto evita congelar el renderizado 3D y la UI web.

Tipo de Algoritmo: Algoritmo de Corte por Guillotina (Guillotine Cut Algorithm) combinado con técnicas heurísticas de selección de mejor ajuste (Best-Fit). Esto asegura que todos los cortes del tablero sean pasantes de lado a lado (necesario para el uso de sierras de mesa convencionales o escuadradoras).

Parámetros de Entrada:

Dimensiones del tablero maestro (ej. $2440 \times 1220 \text{ mm}$).

Margen de perfilado o saneado perimetral del tablero (ej. $10\text{ mm}$ a cada lado para descartar cantos astillados).

Espesor del disco de corte o kerf ($k$, típicamente entre $3.2\text{ mm}$ y $4.5\text{ mm}$).

Lista de piezas rectangulares con su indicador de sentido de veta.

5.2 Estructura del Generador de Plan de Corte (PDF)

La aplicación generará un reporte de producción completo en formato PDF mediante la librería jsPDF. El documento contendrá:

Portada: Datos del proyecto, fecha, resumen de tableros requeridos y métricas de eficiencia (ej. "Consumo: 3 tableros, Desperdicio: 12.4%").

Lista de Materiales de Compra (BOM): Metros lineales totales de tapacanto por grosor, número de herrajes requeridos (bisagras de cazoleta, correderas telescópicas, tiradores, tornillos de ensamble).

Diagramas de Tableros: Páginas horizontales dedicadas a cada tablero optimizado. El diagrama incluirá cotas exactas, el orden de los cortes principales sugeridos y el código correspondiente de cada pieza.

5.3 Exportación CAM para CNC (DXF)

Para talleres automatizados que utilicen enrutadores CNC, la aplicación generará archivos en formato DXF utilizando un enfoque vectorial por capas (Layers).

Capa 0 (Contorno): Perfil exterior completo de la pieza para el corte final con broca helicoidal.

Capa RANURA: Trayectorias en 2.5D para incrustar fondos de mueble.

Capa PERFORACION_BISAGRA: Ubicación exacta para perforación de cazoleta de bisagra (típicamente $\varnothing 35\text{ mm}$ con profundidad de $12\text{ mm}$).

Capa PERFORACION_TARUGO: Guías de broca en los cantos y frentes para tarugos de madera y espigas de ensamble.

6. Fases de Desarrollo e Implementación

> ⚠️ **Orden vigente de entrega**: [`docs/roadmap.md`](docs/roadmap.md).  
> El esquema de 4 fases abajo es la **visión técnica original**. En el repo real
> se priorizó: (A) core matemático → (B) app de taller sin 3D → (C) diseño
> espacial 2D → (D) 3D + CAM profesional. El nesting y el CSV optimizer ya
> existen en dominio/excel **antes** del viewport 3D.

### 6.1 Horizontes (resumen — detalle en roadmap)

| Horizonte | Enfoque | Estado orientativo |
|-----------|---------|--------------------|
| **A** | Tipos, fórmulas, BOM, nesting, storage | Hecho |
| **B** | Shell taller: catálogos, clientes, proyectos, precios, PDF, flujo a producción | En curso (cierre F020+) |
| **C** | Modos 1–2 lite (habitación / colocación espacial) | Futuro |
| **D** | 3D, Modo 3 presentación, DXF, workers, desktop, backend | Futuro |

### 6.2 Visión técnica original (referencia)

Para no perder el mapa CAD/CAM completo, se mantienen los hitos aspiracionales:

```
Fase 1 Core → Fase 2 3D + paneles → Fase 3 Nesting UI / Modo 4 → Fase 4 DXF CNC
```

- **Fase 1 (Core)**: despiece paramétrico TS, tests milimétricos, store + undo/redo.  
  *Hecho en gran parte (sin undo/redo completo en UI).*
- **Fase 2 (3D + UI fluida)**: Viewport3DManager, snapping, paneles, stepper de modos.  
  *Los paneles de catálogo/comercial se adelantaron en Horizonte B; el 3D espera D.*
- **Fase 3 (Producción visual)**: nesting en worker, UI split Modo 4, PDF de corte.  
  *Nesting core y vista SVG básica ya existen; PDF producción y worker = futuro.*
- **Fase 4 (CAM pro)**: DXF capas, config maquinaria, CSV para OptiCut/etc.  
  *CSV optimizer parcial ya existe; DXF no.*

### 6.3 Fuera de scope (anti-scope para agentes)

No implementar sin pedido explícito del usuario:

- Landing marketing, multi-tenant SaaS completo, app móvil nativa.
- Motor de render fotorrealista offline (Cycles, etc.).
- ERP completo (stock, compras, contabilidad) más allá de catálogo y cotización.
- Stack alternativo (Next.js App Router, Supabase “porque ideas.md”) en lugar del monorepo actual.