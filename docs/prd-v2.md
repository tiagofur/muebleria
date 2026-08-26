# PRD v2 — Plataforma operativa para talleres de muebles

**Estado:** CANÓNICO para visión, alcance y modelo operativo actual  
**Fecha:** 2026-08-24  
**Producto:** Granete (antes Muebles / Mueblería — nombre de trabajo)  
**Audiencia:** producto, agentes, implementación, QA y talleres piloto

> Este documento reemplaza a `docs/history/prd.md` como **contrato narrativo actual de producto**.
> `docs/history/prd.md` se conserva como baseline histórico del MVP original y como referencia
> de fórmulas, decisiones y requisitos que sigan siendo compatibles. Ante conflicto,
> gana este PRD v2 + las fuentes ejecutables indicadas en §15.

---

## 1. Definición del producto

Granete es una **plataforma operativa vertical para carpinterías y fabricantes de
muebles pequeños y medianos**. Conecta el trabajo comercial, técnico y físico de
una obra desde la cotización hasta la instalación y la rentabilidad real.

La propuesta de valor ya no se limita a `cotización → BOM → Optimizer.xlsx`.
El producto actual incluye y debe integrar coherentemente:

- clientes, cartera comercial, cotizaciones y pricing;
- catálogo técnico y comercial de muebles, materiales, cantos y herrajes;
- Proyectar 2D/3D y ambientes;
- Granete for SketchUp como authoring client profesional;
- estructuras, componentes, agregados y BOM resuelto;
- ingeniería y documentación de producción;
- optimización de corte para sierra y CNC nesting;
- DXF, perforaciones y preparación CNC;
- almacén, stock, compras y órdenes de compra;
- producción por estaciones y trazabilidad;
- etiquetas y QR;
- embarques e instalación;
- postventa y garantía;
- web, desktop y companion móvil de taller/campo.

### 1.1 Categoría de producto

La definición más precisa es:

> **ERP/MRP/MES vertical ligero + ingeniería paramétrica especializada para muebles.**

No pretende reemplazar un ERP financiero general, un CAD libre ni todos los CAM del
mercado. Su ventaja es entender el lenguaje real del taller y conectar las áreas que
normalmente viven separadas en Excel, papel, WhatsApp y software de máquina.

---

## 2. Norte del producto

> **De vender a producir; de producir a saber si la obra fue rentable.**

El producto debe optimizar tres resultados:

1. **Vender rápido y sin errores:** cotizar y presentar una obra confiable.
2. **Fabricar la revisión correcta:** BOM, piezas, materiales, mecanizados y documentos
   deben corresponder a una misma revisión aprobada.
3. **Cerrar el ciclo económico:** comparar lo estimado con lo realmente consumido en
   material, tiempo, retrabajo y servicios externos.

---

## 3. Usuarios

### 3.1 Taller pequeño

Una misma persona puede vender, proyectar, comprar y supervisar producción. La app
debe ocultar complejidad departamental innecesaria y permitir un flujo corto.

### 3.2 Empresa mediana

Roles especializados:

- vendedor / gerente de ventas;
- proyectista / ingeniero;
- gerente de producción;
- almacén / compras;
- operarios de corte, CNC, enchape y armado;
- embarques;
- instaladores;
- administrador.

RBAC y navegación pueden cambiar la superficie visible, pero todos trabajan sobre la
misma obra y la misma trazabilidad.

### 3.3 Contexto operativo

- escritorio: cotización, ingeniería, compras y gestión;
- taller: cola por estación, escaneo, avance y excepciones;
- campo: levantamiento, instalación, fotos, incidencias y punch list;
- conectividad variable: el companion móvil debe tolerar trabajo offline cuando aplique.

---

## 4. Modos comerciales y rutas de autoría que coexisten

### 4.1 Cotizar rápido

El vendedor conoce lo que necesita y agrega muebles del catálogo sin entrar al editor
espacial. Debe poder llegar a precio y propuesta en minutos.

### 4.2 Proyectar

El vendedor/proyectista trabaja espacios, muros, ubicaciones y materiales en 2D/3D.
El 3D no es decorativo: sus decisiones alimentan el proyecto y deben mantenerse
compatibles con el BOM técnico.

Proyectar permanece como la ruta nativa de quick design: debe resolver el trabajo modular
sin exigir una herramienta CAD externa.

### 4.3 Granete for SketchUp

El diseñador que ya trabaja en SketchUp puede usarlo como ruta de authoring profesional.
La extensión captura selección, interacción, transforms, parameters y semantic metadata;
no calcula la manufacturing truth.

> **SketchUp owns authoring/interaction; Granete owns manufacturing truth.**

Granete conserva catálogo, BOM, parts, materials, hardware, drilling, revisions,
preflight, release y machine outputs. Cotizar rápido, Proyectar y SketchUp convergen en
una misma `Project/Job`.

Ver `docs/sketchup-granete-strategy.md`,
`docs/adr/0001-sketchup-authoring-granete-manufacturing-truth.md` y
`docs/sketchup-manufacturing-contract.md`.

---

## 5. Flujo maestro de una obra

```text
LEAD / CLIENT
     ↓
ESTIMATE / QUOTE
     ↓
QUOTE SENT / FOLLOW-UP
     ↓
WON + CONTRACT / DEPOSIT
     ↓
SITE SURVEY
     ↓
DESIGN
     ↓
REVISION + APPROVAL
     ↓
ENGINEERING
     ↓
PRODUCTION RELEASE
     ↓
FROZEN BOM / MATERIAL REQUIREMENTS
     ↓
RESERVE STOCK / PROCURE SHORTAGE
     ↓
MATERIAL READY
     ↓
PRODUCTION
  CUT → CNC → EDGE BANDING → ASSEMBLY → QC → PACK
     ↓
LOAD / SHIP
     ↓
INSTALLATION VISIT(S)
     ↓
FIELD ISSUES / PUNCH
     ↓
CLIENT SIGN-OFF / CLOSEOUT
     ↓
WARRANTY
```

El flujo puede simplificarse por plantilla de taller, pero no puede perder trazabilidad.

---

## 6. Invariante físico de producción — pieza vs mueble

Ésta es una decisión de producto **cerrada**.

### 6.1 Trabajo por pieza

Las estaciones siguientes trabajan **piezas físicas de tablero**, no muebles completos:

1. **Corte**
2. **CNC / maquinado**
3. **Enchape / canteado / encintado**

La unidad operativa aquí debe ser una instancia de pieza trazable, vinculada a:

- `projectId`;
- revisión/orden de producción;
- `module/item/unit` al que pertenece;
- `partCode`;
- material;
- dimensiones;
- cantos;
- mecanizados/perforaciones;
- etiqueta/QR;
- estado y eventos de estación.

Un mueble puede tener algunas piezas cortadas y otras pendientes. Por lo tanto un único
`ProjectItem.floorStatus = cut` no es granularidad suficiente para representar estas
estaciones a largo plazo.

### 6.2 Punto de convergencia: Armado

**Armado consume piezas terminadas y produce muebles/unidades completas.**

Antes de Armado la pregunta es:

> “¿Qué pasó con esta pieza?”

Desde la salida de Armado la pregunta pasa a ser:

> “¿Qué pasó con este mueble/unidad/bulto?”

### 6.3 Trabajo por mueble/unidad

Las etapas posteriores trabajan muebles, unidades o bultos:

1. Armado
2. QC de mueble
3. Embalaje
4. Carga / embarque
5. Instalación

El modelo objetivo separa `PartExecution` de `ModuleUnitExecution`; ver
`docs/production-flow-v2.md`.

---

## 7. Modelo de estados — no mezclar dimensiones distintas

El producto actualmente tiene varias fuentes parciales de estado. El objetivo es
separar explícitamente:

### 7.1 `CommercialStatus`

```text
draft → sent → won
             ↘ lost
```

Estados adicionales permitidos: `expired`, `cancelled`.

### 7.2 `ProjectStage`

Derivado de eventos, no usado como log mutable independiente:

```text
sales
survey
design
approval
engineering
procurement
production
shipping
installation
punch
completed
warranty
```

### 7.3 `PartExecutionStatus`

```text
pending → cut → machined → edged → ready_for_assembly
                       ↘ rework / scrap
```

La ruta exacta puede variar por pieza: una pieza sin CNC no necesita `machined`; una
pieza sin canto no necesita `edged`.

### 7.4 `ModuleUnitExecutionStatus`

```text
awaiting_parts → assembly → module_qc → packaged → loaded → installed
```

Los estados comerciales, de etapa y físicos no deben colapsarse en un único enum.

---

## 8. Event log como columna vertebral

El proyecto debe evolucionar hacia un log append-only `ProjectEvent[]`.

Ejemplos:

```text
quote_created
quote_sent
quote_won
quote_lost
deposit_received
survey_completed
design_revision_created
design_approved
engineering_started
production_released
materials_reserved
materials_ready
production_started
production_completed
shipment_loaded
shipment_departed
installation_started
installation_completed
punch_closed
client_signed_off
warranty_opened
```

Los eventos de pieza y mueble pueden vivir en streams/tablas específicas, pero deben ser
reconciliables con el lifecycle de la obra.

**Regla:** corregir un hecho genera un evento compensatorio/corrección; no se borra la
historia operacional.

---

## 9. Gates críticos

### 9.1 Ganar una cotización no equivale a liberar producción

`won/accepted` habilita el proceso técnico, pero fabricar requiere un handoff explícito.

### 9.2 Production Release

La liberación de producción debe identificar exactamente:

- revisión de proyecto/diseño;
- fingerprint del BOM;
- actor;
- timestamp;
- checks obligatorios;
- aprobación correspondiente.

Un export generado no sustituye por sí solo a un `ProductionRelease`.

### 9.3 Cambios posteriores

Cualquier modificación de diseño/material/opción que invalide la revisión liberada debe:

1. marcar artefactos/plan como stale;
2. requerir nueva revisión/aprobación;
3. crear `ChangeOrder` cuando cambie alcance, costo o fecha;
4. producir nueva liberación antes de ejecutar cambios físicos.

---

## 10. Materiales, compras y MRP ligero

El BOM aprobado debe alimentar un flujo explícito:

```text
Frozen BOM
   ↓
MaterialRequirement
   ↓
Reservation
   ↓
Shortage
   ↓
PurchaseOrder
   ↓
Receipt
   ↓
Available / Ready
```

Inventario debe distinguir, como mínimo:

- `onHand`;
- `reserved`;
- `available`;
- `incoming`;
- `required`;
- `shortage`.

Un botón “material completo” puede seguir existiendo como confirmación humana, pero no
puede ser la única fuente para afirmar que una obra está lista.

---

## 11. Calidad, retrabajo e instalación

### 11.1 Quality Issue / Rework

Los defectos detectados antes de entrega necesitan trazabilidad propia:

- pieza/unidad;
- estación;
- causa;
- material perdido;
- tiempo perdido;
- resolución: rework/refabricate/scrap/accept;
- responsable y timestamps.

### 11.2 Instalación

Una obra puede requerir varias visitas. El modelo objetivo incluye:

- `InstallationJob`;
- `InstallationVisit`;
- equipo/crew;
- fechas estimadas y reales;
- fotos;
- incidencias de campo;
- `PunchItem`;
- conformidad/cierre.

`loaded → installed` es una transición útil actual, pero no representa por sí sola una
instalación profesional completa.

### 11.3 Warranty

El módulo de garantía existente se mantiene como postventa. Las refabricaciones deben
seguir entrando de forma trazable al circuito de corte/producción.

---

## 12. Job costing — estimado vs real

La cotización responde “¿cuánto esperamos ganar?”. El producto debe también responder
“¿cuánto ganamos realmente?”.

### 12.1 Baseline estimado

Proviene del snapshot de cotización/BOM:

- material;
- cantos;
- herrajes;
- mano de obra estimada;
- servicios externos;
- precio de venta;
- margen esperado.

### 12.2 Actuals

Se alimentan de:

- recepciones/consumo de material;
- movimientos de stock asignados a obra;
- `TimeEntry` por ingeniería/estación/instalación;
- retrabajos y scrap;
- fletes y servicios externos.

### 12.3 Resultado

El job debe mostrar:

```text
estimated cost
actual cost
variance
expected margin
actual margin
```

No se construye contabilidad fiscal/general como parte de este alcance.

---

## 13. Contrato de verdad de datos y métricas

Toda métrica operacional visible debe clasificarse como:

- **actual** — proviene de eventos/mediciones reales;
- **estimated** — cálculo explícitamente estimado;
- **forecast** — predicción futura;
- **proxy** — aproximación documentada temporal.

### Regla dura

> **Nunca presentar un proxy como si fuera un hecho.**

Ejemplos que deben eliminarse o etiquetarse:

- `moduleCount * 8` como número real de piezas;
- `moduleCount * 2.8 m²` como consumo real;
- `moduleCount * 14 ml` como canto real;
- `createdAt` como fecha real de anticipo o entrada a almacén.

Cuando no hay dato real, la UI puede mostrar `—`, “Sin medir” o “Estimado”.

---

## 14. Alcance y anti-scope

### Sí somos

- cotización vertical de muebles;
- CAD/layout especializado limitado a nuestro dominio;
- BOM y documentación de taller;
- MRP ligero;
- inventario/compras operativo;
- MES ligero por estaciones;
- logística/instalación;
- job costing;
- postventa.

### No somos

- CAD libre tipo SketchUp;
- Promob completo/fotorrealismo como objetivo principal;
- contabilidad fiscal completa;
- nómina;
- ERP horizontal para cualquier industria;
- CAM/postprocesador universal para todas las máquinas;
- marketplace de catálogos como prioridad actual.

Integrar herramientas externas es preferible a recrearlas cuando no sea parte del moat.

---

## 15. Fuentes de verdad

| Concern | Autoridad |
|---|---|
| Visión y alcance actual | `docs/prd-v2.md` |
| Plan de consolidación | `docs/operational-core-v1.md` |
| Producción física pieza→mueble | `docs/production-flow-v2.md` |
| Lifecycle/eventos | `docs/project-lifecycle.md` |
| Arquitectura/boundaries | `docs/architecture.md` |
| UX operacional | `docs/operational-ux.md` + `docs/design.md` |
| Roadmap comercial | `docs/roadmap-comercial-v2.md` |
| Programa SketchUp + Granete | `docs/sketchup-granete-strategy.md` + issue #290 |
| Ownership SketchUp/Granete | `docs/adr/0001-sketchup-authoring-granete-manufacturing-truth.md` |
| Contract conceptual | `docs/sketchup-manufacturing-contract.md` |
| Rutas | `apps/web/src/routes.ts` → `NAV_PATHS` |
| Permisos ejecutables | `packages/domain/src/rbac.ts` / backend correspondiente |
| Estado de implementación | código + tests + `feature_list.json` como ledger |
| Trabajo futuro | GitHub issues + roadmap canónico |
| Baseline MVP histórico | `docs/history/prd.md` |

Ante conflicto entre documentación y código:

1. una fuente ejecutable describe **lo implementado hoy**;
2. este PRD describe **la intención aprobada**;
3. la discrepancia debe registrarse y resolverse, no racionalizarse silenciosamente.

---

## 16. Métricas de éxito

### Producto

- cotización típica de cocina en <15 min tras onboarding;
- revisión liberada siempre identificable y reproducible;
- cero ambigüedad sobre qué pieza está en corte/CNC/enchape;
- material shortage visible antes de comprometer producción;
- instalación con pendientes explícitos, no escondidos en notas;
- estimate vs actual disponible por obra.

### Comercial

- 3–5 talleres piloto reales;
- al menos 3 talleres usando el ciclo completo varias semanas;
- medir time-to-quote, tiempo de ingeniería, faltantes, retrabajo, retrasos y margen;
- priorizar nuevas features profundas por demanda observada, no por fascinación técnica.

---

## 17. Regla de evolución

Después de la feature CNC actualmente activa, la prioridad por defecto cambia de
**profundidad técnica adicional** a **consolidación operacional y validación de campo**.

F129–F131 y postprocesadores específicos siguen siendo válidos, pero deben competir por
prioridad contra los gaps del Operational Core y, salvo necesidad confirmada por un
taller piloto, no desplazan los P0/P1 definidos en `docs/operational-core-v1.md`.
