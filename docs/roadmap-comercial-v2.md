# Roadmap Comercial v2 — Prioridad vigente

> **Estado:** ACTIVO  
> **Actualizado:** 2026-08-24  
> **Norte:** producto vendible y operable en talleres reales de LatAm.

Este documento es la fuente narrativa de prioridad comercial. Se complementa con:

- `docs/operational-core-v1.md` — consolidación operacional;
- `docs/proyectar-3d-north-star.md` — quality bar del editor 3D;
- `docs/proyectar-3d-roadmap-vnext.md` — ejecución de Proyectar;
- [`docs/sketchup-muebles-strategy.md`](sketchup-muebles-strategy.md) — programa
  SketchUp + Muebles y sus límites de fabricación;
- GitHub issues — trabajo futuro;
- `feature_list.json` — ledger de implementación/historia.

---

## 0. Posicionamiento

> **Mueblería no es una alternativa barata a Promob.**

Es una plataforma operativa vertical para un segmento de talleres/fabricantes pequeños y
medianos que necesita:

- excelente cotización;
- excelente diseño modular 3D;
- BOM confiable;
- materiales/compras;
- producción;
- CNC cuando aplica;
- instalación;
- job costing.

El precio puede ser menor, pero la razón principal de compra debe ser **calidad,
facilidad, velocidad e integración del flujo completo**.

Ver `docs/proyectar-3d-competitive-position.md`.

---

## 1. Propuesta de valor

> **Plataforma operativa de muebles: cotizar, proyectar, preparar materiales, producir,
> instalar y saber si la obra fue rentable.**

Diferenciadores:

1. cotización rápida con BOM real;
2. Proyectar 2D/3D de nivel profesional para nuestro nicho;
3. corte/etiquetas/CNC integrados al mismo job;
4. flujo material→taller→instalación trazable;
5. rentabilidad por obra;
6. UX específica del taller y fácil de aprender;
7. menor necesidad de unir cinco herramientas externas para completar el trabajo.

Muebles ofrece **tres modos de entrada y dos rutas de autoría 3D**. Cotizar rápido sigue
disponible sin abrir 3D; para autoría espacial coexisten:

- **Proyectar 3D:** ruta nativa de diseño modular rápido;
- **Muebles for SketchUp:** ruta de autoría 3D profesional para usuarios de SketchUp.

Los tres modos de entrada convergen al mismo `Project/Job`. SketchUp y Proyectar capturan
authoring intent; Muebles conserva la única manufacturing truth para catálogo,
relationships/joints, BOM, parts, hardware, drilling, revisions, preflight y machine
outputs.

Ver la [estrategia canónica](sketchup-muebles-strategy.md), el
[ADR-0001](adr/0001-sketchup-authoring-muebles-manufacturing-truth.md) y el
[manufacturing contract](sketchup-manufacturing-contract.md).

---

## 2. Decisiones cerradas

| # | Decisión | Elección |
|---|---|---|
| D1 | Biblioteca de módulos en Proyectar | **Biblioteca lateral persistente permitida y deseable** si mejora discoverability/velocidad; no copiar skin/layout exacto de Promob |
| D2 | Materiales en Proyectar | Biblioteca/material dock accesible dentro del workspace, con grupos/favoritos/recientes y scopes de aplicación |
| D3 | Inspector | Un inspector contextual estable; evolución del actual, no múltiples paradigmas paralelos |
| D4 | Posicionamiento | No competir por ser “más barato”; competir por ser ideal para el nicho y por flujo completo |
| D5 | Fuentes de planificación | Roadmap narrativo + GitHub issues; feature_list como ledger |
| D6 | Nesting | Nativo permitido; sierra y CNC son estrategias distintas |
| D7 | CNC de marca | Postprocesador específico sólo con máquina real confirmada |
| D8 | Granularidad producción | **Corte/CNC/Enchape por pieza; Armado+ por mueble/unidad/bulto** |
| D9 | Profundidad CAD | UX 3D profesional para muebles modulares; no CAD libre generalista |
| D10 | Quality bar Proyectar | Matriz ★ del North Star, validada con usuarios reales |
| D11 | Próxima prioridad operacional | Tras cerrar trabajo activo, Operational Core protege verdad/lifecycle antes de profundidad técnica ilimitada |
| D12 | Trabajo paralelo | Proyectar y SketchUp pueden avanzar por slices de alto impacto activados por pilotos, sin esperar todo Operational Core, pero nunca desplazan sus guardrails de verdad/lifecycle/release/producción |
| D13 | Validación | Pilotos/benchmarks reales pueden reordenar features |
| D14 | SketchUp + Muebles | **SketchUp owns authoring/interaction; Muebles owns manufacturing truth.** Proyectar permanece como ruta nativa rápida; machine compatibility exige evidencia de campo. |
| D15 | Relationships/joints | Constructive intent usa stable IDs/anchors; Muebles resuelve derived placements/drilling. CNC coordinates nunca son authoring truth primaria. |

---

## 3. Tres pilares

### A — Vender

```text
Cliente → Cotización → Proyectar → Presentación → Aprobación
```

### B — Fabricar

```text
Ingeniería → BOM → Materiales → Corte → CNC → Enchape → Armado → QC
```

### C — Operar

```text
Proyecto → Compras → Embarque → Instalación → Warranty → Costing
```

La ventaja de Mueblería es que los tres pilares comparten el mismo job y la misma
revisión, no que cada módulo tenga más botones.

---

## 4. Estado real a 2026-08-21

El producto ya superó el roadmap MVP original:

- Proyectar/3D avanzado;
- multi-space/ambientes;
- herrajes y placements;
- estructuras/agregados en evolución;
- production workspace y estaciones;
- mobile companion;
- stock + purchase orders;
- dashboards por área;
- cut-plan 2D guillotina;
- CNC nesting + DXF;
- machining profiles;
- drilling resolution en trabajo reciente;
- warranty.

Por eso los roadmaps viejos no deben interpretarse como lista lineal pendiente. Código,
tests y `feature_list.json` definen lo implementado; este doc define prioridad.

---

## 5. Proyectar 3D — nueva North Star

Fuente: `docs/proyectar-3d-north-star.md`.

### Meta de calidad

| Área | Target |
|---|---:|
| Encontrar muebles | ★★★★★ |
| Insertar/drag | ★★★★★ |
| Snap | ★★★★★ |
| Dimensiones | ★★★★★ |
| Materiales | ★★★★★ |
| Agregados | ★★★★★ |
| Herrajes | ★★★★★ |
| Selección/contexto | ★★★★★ |
| Undo/redo | ★★★★★ |
| Mover/copiar/duplicar | ★★★★★ |
| Multi-select/align | ★★★★★ |
| Multi-ambiente | ★★★★★ |
| Presentación | ★★★★☆ |
| Fotorrealismo | ★★★☆☆ |
| CAD libre | ★★☆☆☆ |
| Parametrización ultra-compleja | ★★★☆☆ |
| Diseño→producción | ★★★★★+ |

### Modelo mental

```text
Biblioteca persistente → Canvas 3D → Inspector contextual
```

### Meta GitHub

#308 coordina el plan.

### Nuevos slices

- #309 P3D-0 — workspace + bibliotecas;
- #310 P3D-1 — selección/manipulación;
- #311 P3D-4 — environment/multi-space;
- #312 P3D-6 — performance budget;
- #313 P3D-7 — contract tests diseño→BOM→producción;
- #314 P3D-8 — benchmark/validación (no feature).

### Issues existentes reutilizados

- #277 drag insertion;
- #278 inspector;
- #279 materiales;
- #280–#282 herrajes;
- #266 ambient materials;
- #260 presentation;
- #294–#297 agregados.

No duplicar estos issues sólo para adaptar naming.

---

## 6. Orden recomendado de Proyectar

Cuando haya capacidad dedicada al editor:

1. #309 biblioteca/workspace;
2. #277 insertion + #310 manipulation;
3. #278 inspector + #279 materials;
4. #294–#297 aggregates + #280–#282 hardware según dependencias;
5. #311 environment/multi-space;
6. #260 presentation;
7. #312 performance hardening transversal;
8. #313 integration contracts;
9. #314 validation continua.

Este orden puede cambiar con evidencia de piloto.

---

## 7. Operational Core O0 — Guardrails y verdad (P0)

Fuente: `docs/operational-core-v1.md` OC-001–006 / issue #299.

- arreglar `init.sh`;
- CI remoto;
- reconciliar roadmap/issues/ledger;
- roles canónicos;
- auth DTO seguro;
- Data Truth Contract.

**Resultado:** “done”, “verde”, “rol” y “KPI real” tienen significado único.

---

## 8. Operational Core O1 — Lifecycle + Release (P0)

Issue #300.

- `ProjectEvent[]`;
- commercial status real;
- stage derivado;
- anticipo real;
- DesignRevision;
- Approval;
- ProductionRelease;
- stale detection;
- ChangeOrder.

**Resultado:** siempre sabemos qué se vendió, aprobó y fabricó.

Dependencia importante para Proyectar y SketchUp: cambios post-release deben activar
stale/release, no overwrite silencioso.

---

## 9. Operational Core O2 — Producción pieza→mueble (P0)

Issue #301 + `docs/production-flow-v2.md`.

```text
Corte → CNC → Enchape       (pieza)
Armado → QC → Pack → Load   (mueble/unidad/bulto)
```

Esto conecta directamente con drilling/CNC derivado desde authoring/Ingeniería.

---

## 10. Operational Core O3 — Materiales + QC (P1)

Issue #302.

- requirements desde BOM;
- reservas;
- shortage;
- PO/receiving;
- material-ready con evidencia;
- QualityIssue;
- rework/scrap;
- QC gates.

---

## 11. Operational Core O4 — Instalación/closeout (P1)

Issue #303.

- InstallationJob;
- visitas;
- crews;
- field issues;
- punch list;
- sign-off/closeout.

---

## 12. Operational Core O5 — Job Costing (P1)

Issue #304.

- CostBaseline;
- TimeEntry;
- material actual;
- other actuals;
- estimate vs actual;
- actual margin.

---

## 13. UX transversal y Survey

Issue #305.

- Site Survey estructurado;
- Project Workspace transversal;
- dashboards exception-first;
- navegación pequeña vs mediana empresa.

---

## 14. Pilotos

Issue #306.

No esperar a “terminar todo”. Pilotos validan:

- quote flow;
- Proyectar/SketchUp cuando aplique;
- survey;
- approvals;
- materials;
- Cut/CNC/Edge;
- assembly/QC;
- shipping/install;
- costing.

Cuando exista `type:validation`, #306 y #314 deben usarlo.

---

## 15. CNC profundo F129–F132

Sigue siendo válido:

- joint drilling rules;
- drilling DXF;
- visual drilling editor;
- postprocesador específico.

Pero no desplaza automáticamente Operational Core o Proyectar UX.

Se prioriza cuando:

1. piloto real lo necesita;
2. desbloquea venta concreta;
3. completa cadena usada;
4. producto asume explícitamente el tradeoff.

Postprocesadores de marca requieren hardware/software confirmados.

---

## 16. Lanzamiento/comercial

Packaging, onboarding/demo, pricing/landing/script siguen siendo esenciales.

No permitir que features técnicas pospongan indefinidamente:

- instalador usable;
- demo excelente;
- onboarding;
- materiales/catálogos semilla;
- pricing validado;
- ventas reales.

---

## 17. Features condicionadas

Por defecto necesitan demanda demostrada:

- render premium backend;
- acabados extremadamente complejos;
- postprocesadores de marca;
- CAD libre;
- marketplace;
- forecasting/multi-planta avanzado.

### SketchUp — condición comercial activada

El plugin SketchUp dejó de ser una idea genérica congelada porque existen pilotos y
máquinas concretas por caracterizar. El programa activo es
[#290](https://github.com/tiagofur/muebleria/issues/290) y se ejecuta mediante
[`docs/sketchup-muebles-strategy.md`](sketchup-muebles-strategy.md).

La activación autoriza contrato, dossiers, validación y trabajo por fases. No autoriza
afirmar compatibilidad PTX/CNC sin import/readback y operator sign-off, ni mover BOM,
relationship/joint resolution, drilling o postprocessing a Ruby/SketchUp.

Este es un carril paralelo pilot-driven. Sus prioridades P0/P1/P2 ordenan el programa
SketchUp, pero no desplazan los guardrails del Operational Core. En especial, #300/#301
siguen siendo autoridades de lifecycle/release y producción física, y una entrega
SketchUp no puede fabricar, liberar ni ocultar stale state mientras esos contratos no se
cumplan. La fase documental #344 ya fue completada por PR #357.

### Primer vertical slice demostrable

```text
contract approved
→ initial machine dossiers collected
→ extension skeleton
→ semantic round-trip
→ parametric part relationships / joints
→ #347 minimum authoritative preflight milestone verified
→ one cabinet passes minimum authoritative preflight
→ hardware placement + machining sync
→ commercial demo
→ #347 full Definition of Done before PTX/machine validation
```

`Initial machine dossiers collected` es discovery sanitizado, no el cierre de
#352/#353. El milestone mínimo de #347 corre sobre el fixture de #356 después de cerrar
relationships/joints y antes de iniciar implementación dependiente de #349/#350,
considerar un gabinete manufacturable o ejecutar el demo. Los fixtures posteriores
vuelven a pasar el gate. El cierre completo de #347 es una hard prerequisite distinta
para #348/#351.

El primer hito mostrable debe probar que mover/agregar/eliminar un entrepaño recalcula
sólo machining dependiente, mover una bisagra actualiza únicamente su machining y un
cambio que afecte manufacturing truth actualiza fingerprint/revision y vuelve stale una
release anterior.

Las autoridades para este slice son #356 y el milestone mínimo de #347; los goldens
correspondientes viven en #354.

---

## 18. Anti-scope

- no “Promob completo”;
- no “Promob barato” como positioning;
- no SketchUp interno;
- no contabilidad fiscal/nómina;
- no ERP horizontal;
- no CAM universal;
- no integraciones de máquina sin hardware real;
- no coordenadas CNC persistidas como truth de relationships/joints;
- no dashboards con proxies como hechos;
- no features CAD añadidas sólo para igualar una checklist competitiva.

---

## 19. Métricas de éxito

### Proyectar

Targets iniciales de benchmark:

- primer módulo colocado <60 s usuario nuevo;
- cambio de material común <15 s;
- agregado común <30 s;
- duplicar/alinear 3 unidades <30 s;
- 0 necesidad de conocer internals del BOM.

Validar mediante #314; recalibrar con evidencia.

### Piloto operacional

- 3–5 talleres reales;
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

### 12 meses

- 15–30 talleres pagando como objetivo orientativo;
- MRR compatible con pricing validado;
- quote time <15 min en catálogo conocido;
- evidencia de reducción de errores/retrabajo;
- Proyectar percibido como herramienta profesional por usuarios del nicho.

---

## 20. Cómo se actualiza este roadmap

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
actualizar las fuentes canónicas, no sólo el JSON.
