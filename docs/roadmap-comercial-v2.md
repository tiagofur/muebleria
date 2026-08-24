# Roadmap Comercial v2 — Prioridad vigente

> **Estado:** ACTIVO  
> **Actualizado:** 2026-08-24  
> **Norte:** producto vendible y operable en talleres reales de LatAm.

Este documento es la fuente narrativa de prioridad comercial. Se complementa con:

- `docs/operational-core-v1.md` — consolidación operacional;
- `docs/proyectar-3d-north-star.md` — quality bar del editor 3D;
- `docs/proyectar-3d-roadmap-vnext.md` — ejecución de Proyectar;
- [`docs/sketchup-muebles-strategy.md`](sketchup-muebles-strategy.md) — programa SketchUp + Muebles y sus límites de fabricación;
- GitHub issues — trabajo futuro;
- `feature_list.json` — ledger de implementación/historia.

## 0. Posicionamiento

> **Mueblería no es una alternativa barata a Promob.**

Es una plataforma operativa vertical para un segmento de talleres/fabricantes pequeños y
medianos que necesita excelente cotización, diseño modular 3D, BOM confiable,
materiales/compras, producción, CNC cuando aplica, instalación y job costing.

El precio puede ser menor, pero la razón principal de compra debe ser **calidad,
facilidad, velocidad e integración del flujo completo**.

## 1. Propuesta de valor

> **Plataforma operativa de muebles: cotizar, proyectar, preparar materiales, producir,
> instalar y saber si la obra fue rentable.**

Cotizar rápido sigue disponible sin abrir 3D. Para autoría espacial coexisten:

- **Proyectar 3D:** ruta nativa de diseño modular rápido;
- **Muebles for SketchUp:** ruta de autoría 3D profesional.

Las tres entradas convergen al mismo `Project/Job`. SketchUp y Proyectar capturan
authoring intent; Muebles conserva la única manufacturing truth para catálogo,
relationships/joints, BOM, parts, hardware, drilling, revisions, preflight y machine
outputs.

> **SketchUp owns authoring/interaction; Muebles owns manufacturing truth.**

## 2. Decisiones cerradas

| # | Decisión | Elección |
|---|---|---|
| D1 | Biblioteca de módulos en Proyectar | Biblioteca lateral persistente permitida y deseable |
| D2 | Materiales en Proyectar | Biblioteca/material dock accesible dentro del workspace |
| D3 | Inspector | Un inspector contextual estable |
| D4 | Posicionamiento | No competir por ser “más barato”; competir por flujo completo y calidad |
| D5 | Nesting | Nativo permitido; sierra y CNC son estrategias distintas |
| D6 | CNC de marca | Postprocesador específico sólo con máquina real confirmada |
| D7 | Granularidad producción | Corte/CNC/Enchape por pieza; Armado+ por mueble/unidad/bulto |
| D8 | Profundidad CAD | UX 3D profesional para muebles modulares; no CAD libre generalista |
| D9 | Validación | Pilotos/benchmarks reales pueden reordenar features |
| D10 | SketchUp + Muebles | Proyectar sigue como ruta nativa; SketchUp es authoring profesional |
| D11 | Manufacturing truth | Muebles resuelve relationships/joints, BOM, machining, preflight y release |
| D12 | Parametric relationships | Derived drilling nace de intención constructiva; no de coordenadas CNC persistidas |

## 3. Tres pilares

### A — Vender

```text
Cliente → Cotización → Proyectar/SketchUp → Presentación → Aprobación
```

### B — Fabricar

```text
Ingeniería → BOM → Materiales → Corte → CNC → Enchape → Armado → QC
```

### C — Operar

```text
Proyecto → Compras → Embarque → Instalación → Warranty → Costing
```

La ventaja de Mueblería es que los tres pilares comparten el mismo job y la misma revisión.

## 4. Proyectar 3D

Fuente: `docs/proyectar-3d-north-star.md`.

El editor nativo mantiene su calidad objetivo y no se reemplaza por SketchUp. Los issues
#308–#314 continúan siendo la autoridad de producto/validación para Proyectar.

## 5. Operational Core

Operational Core protege lifecycle, release, granularidad física, materiales, QC,
instalación y job costing. En particular:

- #300 — lifecycle, `ProductionRelease`, stale detection y change orders;
- #301 — piezas hasta Enchape, unidades desde Armado;
- #302 — MRP ligero, compras, QC y retrabajo;
- #303 — instalación/closeout;
- #304 — job costing;
- #305 — UX transversal/survey;
- #306 — pilotos reales.

## 6. SketchUp + Muebles — programa activo

El plan histórico del plugin dejó de estar congelado porque existen pilotos/clientes
concretos y máquinas reales por caracterizar. El programa vigente es #290.

### Backlog principal

- #344 architecture/manufacturing contract;
- #345 extension bootstrap;
- #346 semantic metadata + round-trip;
- #356 parametric part relationships + joint-driven machining;
- #347 manufacturing preflight;
- #348 PTX import/readback validation;
- #349 parametric library MVP;
- #350 hardware placement/machining sync;
- #351 machine profiles/postprocessors;
- #352 Client A machine pack;
- #353 Client B machine pack;
- #354 golden/E2E manufacturing tests;
- #355 packaging/licensing/update strategy.

### Primer vertical slice comercial

```text
contract approved
→ machine dossiers collected
→ extension skeleton
→ semantic round-trip
→ parametric part relationships / joints
→ one manufacturable cabinet
→ hardware placement + machining sync
→ minimum authoritative preflight
→ commercial demo
```

El primer hito mostrable no es “plugin instalado”. Debe probar con un gabinete real que:

- cambiar dimensiones mantiene coherencia;
- mover/agregar/eliminar entrepaños actualiza relationships y machining dependiente;
- mover una bisagra actualiza su machining sin alterar el del entrepaño;
- piezas/BOM/cantos/drilling se recalculan;
- el fingerprint cambia cuando cambia manufacturing truth;
- un output liberado queda stale cuando corresponde.

## 7. Machine evidence

No se declara soporte por marca genérica. La compatibilidad corresponde a una combinación
exacta de machine/controller/software/profile version y necesita:

1. fixture reproducible;
2. export;
3. import en el software receptor;
4. readback de cantidades/dimensiones/orientación/operaciones;
5. expected vs actual;
6. operator sign-off.

Client A y Client B se validan independientemente.

## 8. CNC profundo y postprocessors

Joint drilling rules, drilling DXF, editor visual de perforaciones y postprocesadores
siguen siendo válidos cuando demanda real los justifique. Ningún adapter puede redefinir
BOM, relationship resolution o drilling del core.

## 9. Lanzamiento/comercial

No permitir que features técnicas pospongan indefinidamente:

- instalador usable;
- demo excelente;
- onboarding;
- materiales/catálogos semilla;
- pricing validado;
- ventas reales.

## 10. Features condicionadas

Por defecto necesitan demanda demostrada:

- render premium backend;
- acabados extremadamente complejos;
- postprocesadores adicionales de marca;
- CAD libre;
- marketplace;
- forecasting/multi-planta avanzado.

## 11. Anti-scope

- no “Promob completo”;
- no “Promob barato” como positioning;
- no SketchUp interno;
- no contabilidad fiscal/nómina;
- no ERP horizontal;
- no CAM universal;
- no integraciones de máquina sin hardware/software real;
- no coordenadas CNC persistidas como truth de joints;
- no client-specific conditionals dispersos en el core;
- no dashboards con proxies como hechos.

## 12. Métricas de éxito

### Proyectar

Targets iniciales de benchmark:

- primer módulo colocado <60 s usuario nuevo;
- cambio de material común <15 s;
- agregado común <30 s;
- duplicar/alinear 3 unidades <30 s;
- 0 necesidad de conocer internals del BOM.

### Piloto operacional

- al menos una obra venta→producción→instalación;
- ninguna revisión equivocada por falta de gate;
- shortages visibles antes de corte;
- retrabajo/punch explícito;
- quote time medido;
- margen real disponible cuando O5 esté listo.

### SketchUp manufacturing bridge

- un gabinete real completa el vertical slice;
- shelf move/add/remove produce machining determinístico;
- hinge move no altera machining no relacionado;
- PTX/machine support sólo se marca validated con evidence.

## 13. Fuentes

- producto: `docs/prd-v2.md`;
- posicionamiento Proyectar: `docs/proyectar-3d-competitive-position.md`;
- calidad Proyectar: `docs/proyectar-3d-north-star.md`;
- ejecución Proyectar: `docs/proyectar-3d-roadmap-vnext.md`;
- programa SketchUp + Muebles: `docs/sketchup-muebles-strategy.md`;
- boundary: `docs/adr/0001-sketchup-authoring-muebles-manufacturing-truth.md`;
- contract conceptual: `docs/sketchup-manufacturing-contract.md`;
- relationships/joints: #356;
- consolidación operacional: `docs/operational-core-v1.md`;
- issues: trabajo futuro;
- ledger: `feature_list.json`;
- código/tests: verdad implementada.

No crear roadmaps paralelos no referenciados. Cuando una capacidad grande se cierra,
actualizar fuentes canónicas, no sólo el JSON.
