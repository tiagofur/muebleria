# Roadmap Comercial v2 — Prioridad vigente

> **Estado:** ACTIVO  
> **Actualizado:** 2026-09-05
> **Norte:** producto vendible y operable en talleres reales de LatAm.

Este documento es la fuente narrativa de prioridad comercial. Se complementa con:

- `docs/operational-core-v1.md` — consolidación operacional;
- `docs/proyectar-3d-north-star.md` — quality bar del editor 3D;
- `docs/proyectar-3d-roadmap-vnext.md` — ejecución de Proyectar;
- [`docs/sketchup-granete-strategy.md`](sketchup-granete-strategy.md) — programa
  SketchUp + Granete y sus límites de fabricación;
- GitHub issues — trabajo futuro;
- `feature_list.json` — ledger de implementación/historia.

---

## 0. Posicionamiento

> **Granete no es una alternativa barata a Promob.**

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

Granete ofrece **tres modos de entrada y dos rutas de autoría 3D**. Cotizar rápido sigue
disponible sin abrir 3D; para autoría espacial coexisten:

- **Proyectar 3D:** ruta nativa de diseño modular rápido;
- **Granete for SketchUp:** ruta de autoría 3D profesional para usuarios de SketchUp.

Los tres modos de entrada convergen al mismo `Project/Job`. SketchUp y Proyectar capturan
authoring intent; Granete conserva la única manufacturing truth para catálogo,
relationships/joints, BOM, parts, hardware, drilling, revisions, preflight y machine
outputs.

Ver la [estrategia canónica](sketchup-granete-strategy.md), el
[ADR-0001](adr/0001-sketchup-authoring-granete-manufacturing-truth.md) y el
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
| D14 | SketchUp + Granete | **SketchUp owns authoring/interaction; Granete owns manufacturing truth.** Proyectar permanece como ruta nativa rápida; machine compatibility exige evidencia de campo. |
| D15 | Relationships/joints | Constructive intent usa stable IDs/anchors; Granete resuelve derived placements/drilling. CNC coordinates nunca son authoring truth primaria. |

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

La ventaja de Granete es que los tres pilares comparten el mismo job y la misma
revisión, no que cada módulo tenga más botones.

---

## 4. Estado reconciliado y siguiente entrega

El [plan DEMO → MVP del 5 de septiembre](demo-mvp-plan-2026-09-05.md) fija la evidencia:
29 PRs integradas y 18 issues cerradas en la ventana ampliada del 2 de septiembre UTC
al corte consultado. Gate A y el hilo Project/FurnitureInstance/Design/publicación/
reconciliación/requote/aprobación/release son base aprovechable, no una nueva ola por
reimplementar. #498/#466/#467/#468 también están integrados.

El readback de publicación posterior integró #500/PR #565, sin alterar esos conteos
históricos. Esto no significa que todas las superficies estén terminadas: #501/#502/#497/#499 siguen pendientes; #496 conserva alcance abierto. #390,
#391 y #470 tienen PRs fusionadas pero sus issues continúan abiertas. Se revisan los
criterios antes de tocar código o cerrar tickets. #462 continúa abierto por Gate B,
no porque deba repetirse la fundación del Digital Thread desde cero.

## 5. Orden comercial vigente: DEMO → MVP → expansión

| Etapa | Resultado vendible/demostrable | Trabajo prioritario y límite |
|---|---|---|
| 0. Documentación | Una narrativa que distingue capacidades, implementación y evidencia | Esta actualización; después reconciliar issues existentes, sin duplicarlos. |
| 1. DEMO | Una obra comprensible desde venta hasta revisión liberada y continuidad operacional | Reutilizar #500/#565 integrado; completar #501 y después #502 sobre backend existente; catálogo conocido y ensayo web/host. No rediseño total de biblioteca. |
| 2. Integridad del piloto | Ninguna salida, escritura o saldo parece correcto cuando está incompleto | RV-06–10/#443 y estados industriales explícitos según rutas usadas. Corregir o bloquear antes de exponer/fabricar; no aplazar silenciosamente por llamarlo demo. |
| 3. Biblioteca industrial mínima | Los muebles prioritarios de los dos prospectos se configuran y fabrican sin recetas ocultas | #496/#497, herrajes administrables y recetas de ensamble/box/perfil seleccionadas por demanda; reutilizar Agregado/PartRelationship. |
| 4. Fabricación cualificada | Cada cliente importa y valida su salida concreta | #348 → #351 → #352/#353 → #503/#354, sin saltar bloqueos de dossier/readback. |
| 5. MVP operable y vendible | Cliente repite su trabajo, recupera errores y recibe soporte | #355 y dependencias de seguridad/host/update/rollback; medir uso y disposición a pagar, no asumir contratos. |
| 6. Expansión | Más clientes/catálogos/canales con evidencia | Gate B para colaboración cross-org; amplitud de recetas, productividad y automatización según piloto. |

Son resultados, no un nuevo dependency graph competidor. Cada issue conserva su hard
prerequisite; documentación o discovery independientes pueden avanzar sin declararlos
resueltos. Una necesidad real de máquina puede adelantar su discovery, pero no elimina
integridad, release exacto ni validación física.

## 6. Experiencia DEMO

```text
Cotización → unidades físicas → SketchUp → conflicto y corrección → preflight vigente
→ publicación → historia web → reconciliación/requote → aprobación/release exacto
→ BOM/materiales → piezas en taller → unidad armada → instalación
```

Mostrar las conexiones que realmente funcionan y declarar las que aún requieren
asistencia. Enrollment de SketchUp no reemplaza pairing #499; sin este último se usa
handoff manual explícito, no un botón que simula confirmación. Los exports de máquina
no se presentan como validados sin readback de la combinación exacta.

El [reporte de readiness anterior](demo-golden-path-readiness-20260905.md) se conserva
como evidencia de un guion condicionado. No certifica por sí solo esta aceptación web
ampliada ni autoriza usar rutas con pérdida silenciosa en producción.

## 7. Conceptos e ideas incorporados del review

El [review del 5 de septiembre](Granete_review_plan_ejecucion_2026-09-05.md) alimenta la
evolución, no una reescritura:

1. **Herraje industrial administrable:** representación, receta definida y receta
   validada son estados independientes; banco de prueba sobre piezas reales.
2. **Ensambles configurables:** reglas versionadas por taller y operaciones explícitas
   por cara/pieza, sobre `PartRelationship` existente.
3. **Recetas de Agregado:** cajón box y frente con perfil cambian componentes, compras,
   perforaciones y costo juntos; simular diferencias y aplicar atómicamente.
4. **3D coherente:** completar la escena común; proxies y ausencias visibles. #529
   separa movimiento de presentación de verdad industrial y actores fijos/móviles.
5. **Trabajo visible:** siguiente acción, bloqueo y revisión exacta en React; no
   duplicar resolver/reconciliación para compensar APIs incompletas.

La matriz RV-01–12 y el riesgo de invalidación de preflight del
[plan de ejecución](demo-mvp-plan-2026-09-05.md) asignan exposición/aceptación. Estas ideas
son objetivos; no se anuncian como features ya implementadas.

## 8. Programas que se conservan, sin reiniciar entregas

| Programa | Autoridad | Uso en la etapa actual |
|---|---|---|
| Proyectar 3D | North Star + `proyectar-3d-roadmap-vnext.md`, #308 | Biblioteca persistente → canvas → inspector; mantener capacidad actual. Gaps medidos por piloto, no repetir issues históricas cerradas. |
| Operational Core | `operational-core-v1.md`, #299–#306 | Catálogo de criterios de verdad/lifecycle/pieza→mueble/material/QC/instalación/costos; comparar implementación antes de crear pendientes. |
| Digital Thread | #384, ADR-0003, #396 | Reutilizar identidad/revisiones/release existentes y completar lectura/comandos web. |
| SketchUp | #465 y contrato cross-surface; #290 contexto histórico | Reutilizar host runtime y autoría profesional; ampliar evidencia/consumidores. |
| Organization Foundation | #446/#462 y ADR-0006 | Conservar Gate A; Gate B condiciona el alcance cross-org. |
| Máquina/comercial | #348/#351–#355/#503 | Dossiers y evidencia independiente de los dos clientes potenciales. |

Las antiguas olas “arreglar init → crear DesignRevision → crear release” y “extension
skeleton → semantic roundtrip” no son la próxima secuencia completa: incluyen trabajo
ya realizado. Mantener sus guardrails, no convertirlos otra vez en backlog desde cero.

## 9. Lo que no debe retrasar la primera DEMO

Salvo que una ruta mostrada lo necesite: rediseño completo de biblioteca, CAD libre,
fotorrealismo premium, red comercial amplia, agentes de transferencia a máquina,
productividad masiva #469/#471 y soporte offline completo #474. Se conservan en sus
programas; no son descartes definitivos.

Esto **no difiere** fallos de integridad de rutas usadas. Si el guion evita una ruta
insegura, la exclusión se declara; si el piloto la necesita, se resuelve antes de producir.

## 10. MVP para dos prospectos

Confirmar por separado familia de muebles, tareas, biblioteca mínima, máquina,
controlador/software/versión, herramientas, formatos y criterio de compra. Los dossiers
#352/#353 no se completan por marca ni por copiar la evidencia del otro cliente.

El MVP necesita uso repetible, seguridad, conservación de datos, instalación y soporte;
no toda la amplitud de un ERP. Importación manual cualificada puede preceder a envío
automático, con menor complejidad pero trabajo del operador explícito. No confundir
archivo transferido con programa seguro ni con pieza fabricada correctamente.

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

- primero los dos clientes potenciales, con alcance y fabricación cualificada por separado;
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
- programa SketchUp + Granete: `docs/sketchup-granete-strategy.md`;
- boundary: `docs/adr/0001-sketchup-authoring-granete-manufacturing-truth.md`;
- contract conceptual: `docs/sketchup-manufacturing-contract.md`;
- relationships/joints: #356;
- consolidación operacional: `docs/operational-core-v1.md`;
- issues: trabajo futuro;
- ledger: `feature_list.json`;
- código/tests: verdad implementada.

No crear roadmaps paralelos no referenciados. Cuando una capacidad grande se cierra,
actualizar las fuentes canónicas, no sólo el JSON.
