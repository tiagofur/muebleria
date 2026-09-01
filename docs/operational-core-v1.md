# Operational Core v1 — Plan de consolidación del producto

**Estado:** CANÓNICO para mejoras operativas post-review  
**Fecha:** 2026-08-21  
**Objetivo:** alinear el producto existente con el flujo real de una carpintería/empresa de muebles pequeña y mediana antes de seguir profundizando features especializadas.

---

## 1. Por qué existe este documento

El producto ya superó el alcance del MVP original. Hoy existen capacidades fuertes en
cotización, 3D, ingeniería, BOM, stock, compras, producción, logística, instalación,
warranty, nesting y CNC. El riesgo principal dejó de ser “faltan features básicas” y
pasó a ser:

> **muchos subsistemas buenos unidos por una columna vertebral operacional todavía parcial.**

Operational Core v1 organiza el trabajo necesario para que la app pueda responder de
forma consistente:

- ¿qué se vendió y cuándo se ganó/perdió?;
- ¿qué revisión fue aprobada?;
- ¿qué revisión está liberada para fabricar?;
- ¿qué materiales faltan?;
- ¿qué piezas están en corte, CNC o enchape?;
- ¿qué muebles están en armado, QC, empaque, carga o instalación?;
- ¿qué quedó pendiente en obra?;
- ¿cuánto costó realmente el trabajo?;
- ¿qué números del dashboard son hechos y cuáles estimaciones?

---

## 2. Principios del plan

1. **No reescribir.** Migración gradual sobre el dominio actual.
2. **Una verdad por concepto.** Estados redundantes deben derivarse o deprecarse.
3. **Eventos antes que flags sueltos.** Hitos del trabajo son auditables.
4. **Production Release explícito.** Aceptar cotización no equivale a autorizar corte.
5. **Pieza antes de Armado; mueble después.** Regla física canónica.
6. **BOM aprobado impulsa materiales.** Compras no vive desconectado de ingeniería.
7. **Métrica honesta.** Proxy ≠ dato real.
8. **Excepción primero.** Dashboards gerenciales priorizan riesgos y bloqueos.
9. **Piloto real manda.** Features profundas deben ganar prioridad por evidencia de campo.
10. **Compatibilidad progresiva.** El modelo legacy puede coexistir mientras migra.

---

## 3. Prioridad P0 — integridad y fuentes de verdad

### OC-001 — Corregir harness `init.sh`

**Problema:** el fallback `|| true` puede convertir un fallo de `pnpm install` en aparente éxito; ausencia de `pnpm` puede terminar como warning aunque el gate pretenda ser obligatorio.

**Objetivo:** `./init.sh` verde significa realmente entorno + tests válidos.

**Aceptación:**

- ningún install fallido termina en `[OK]`;
- en monorepo existente, ausencia de Node/pnpm requerido falla el gate;
- tests y typecheck necesarios no se omiten silenciosamente;
- test del script o smoke reproducible documentado;
- `docs/verification.md` coincide con el comportamiento real.

### OC-002 — CI remoto obligatorio

**Objetivo:** no depender únicamente de evidencia local de agentes.

**Checks mínimos:**

- JSON/schema de `feature_list.json`;
- `pnpm test`;
- `pnpm typecheck`;
- Go tests;
- checks de boundaries/arquitectura si existen;
- verificaciones específicas de exports cuando cambien.

### OC-003 — Reconciliar backlog y ledger

**Problema:** roadmap, issues, PRD y `feature_list.json` pueden divergir.

**Contrato nuevo:**

- `docs/roadmap-comercial-v2.md` = narrativa/prioridad;
- GitHub issues = trabajo futuro humano;
- `feature_list.json` = ledger ejecutable/histórico de implementación;
- código + tests = verdad de lo implementado.

**Trabajo:**

- detectar issues abiertos ya implementados y cerrarlos/reclasificarlos;
- evitar que una feature `done` signifique “idea terminada” sin evidencia;
- documentar `implemented`, `verified`, `released`, `frozen`, `superseded` aunque el schema se migre gradualmente.

### OC-004 — Consolidar roles

**Problema:** `UserRole` y `ProductRole` no contienen exactamente los mismos valores.

**Objetivo:** una sola fuente canónica para roles de producto, con mapping backend explícito.

### OC-005 — Endurecer DTO de autenticación

**Objetivo:** respuestas HTTP nunca serializan entidades internas con secretos.

**Trabajo:**

- `PublicUserDTO` explícito;
- login/refresh/list user con DTO público;
- test que garantiza ausencia de password hash;
- ~~revisar estrategia de `?token=` para media y planear URLs firmadas/token específico~~ resuelto por #460 SEC-3: grants `media_read` short-lived resource-scoped (`POST /api/media:authorize`), sin session JWT en query.

### OC-006 — Data Truth Contract

**Objetivo:** cada KPI declara `actual | estimated | forecast | proxy`.

**Correcciones iniciales:**

- eliminar o etiquetar `moduleCount * 8`;
- eliminar o etiquetar `2.8 m²/module`;
- eliminar o etiquetar `14 ml/module`;
- eliminar o etiquetar `4 hardware/module`;
- no usar `createdAt` como depósito/entrada a almacén sin copy explícito.

---

## 4. Prioridad P0 — lifecycle canónico

### OC-010 — `ProjectEvent[]` append-only

Implementar el diseño que ya existe en `docs/project-lifecycle.md` y ampliarlo.

**Eventos mínimos primera fase:**

```text
quote_created
quote_sent
quote_won
quote_lost
deposit_received
survey_completed
engineering_started
engineering_documented
production_released
materials_ready
production_started
production_completed
shipment_loaded
installation_completed
project_closed
```

**Reglas:**

- id único;
- actor;
- timestamp ISO con hora;
- payload opcional versionado;
- no delete/update histórico directo;
- eventos compensatorios para correcciones.

### OC-011 — Separar `CommercialStatus`

Objetivo inicial:

```text
draft | sent | won | lost | expired | cancelled
```

No forzar migración destructiva de `ProjectStatus` en una sola feature; crear adaptación/derivación compatible.

### OC-012 — `ProjectStage` derivado

Stage visible de una obra deriva de eventos/gates, no compite con otros status:

```text
sales → survey → design → approval → engineering → procurement → production
→ shipping → installation → punch → completed → warranty
```

### OC-013 — Anticipo real

Eliminar el uso de `createdAt` como proxy de `deposit_received` para tiempos de ingeniería.

---

## 5. Prioridad P0 — aprobación y liberación a producción

### OC-020 — `DesignRevision`

Toda revisión importante debe poder identificarse y compararse con la liberada.

Debe vincular como mínimo:

- project version;
- diseño/layout;
- choices relevantes;
- BOM fingerprint calculable;
- autor y fecha.

### OC-021 — `Approval`

Estados recomendados:

```text
pending
approved
approved_with_notes
changes_requested
rejected
```

Tipos posibles:

- cliente/comercial;
- técnico/ingeniería;
- supervisor.

### OC-022 — `ProductionRelease`

Objeto explícito y auditable.

**Campos mínimos:**

```text
projectId
projectVersion
designRevisionId
bomFingerprint
releasedBy
releasedAt
checks[]
```

**Gate:** ningún trabajo físico nuevo debe arrancar contra una revisión stale.

### OC-023 — Stale detection uniforme

Cualquier cambio que afecte BOM/diseño tras release marca:

- documentos;
- cut plan;
- CNC output;
- labels;
- material requirements;

como stale hasta nueva liberación.

### OC-024 — `ChangeOrder`

Se activa cuando un cambio post-aprobación impacta alcance/costo/plazo.

**Campos:**

- requestedBy;
- reason;
- sourceRevision;
- targetRevision;
- price impact;
- material/labor impact;
- schedule impact;
- approval;
- timestamps.

---

## 6. Prioridad P0 — modelo físico de producción

### OC-030 — `PartInstance` / `PartExecution`

Crear una identidad operativa para cada pieza física producida.

**Motivación:** Corte, CNC y Enchape trabajan piezas individuales.

**Debe permitir:**

- una pieza cortada mientras otra del mismo mueble espera;
- QR scan por pieza;
- mecanizado por pieza/cara;
- rework/scrap de una pieza;
- estadísticas reales de WIP por estación.

### OC-031 — Pipeline por ruta, no enum rígido único

Una pieza puede requerir:

```text
cut → cnc → edge
```

otra:

```text
cut → edge
```

y otra:

```text
cnc-nesting → edge
```

La ruta se deriva de operaciones necesarias; no todas las piezas cruzan todas las estaciones.

### OC-032 — Armado como handoff pieza→mueble

Armado sólo puede iniciar cuando las piezas requeridas para la unidad están disponibles o existe override supervisor auditado.

### OC-033 — `ModuleUnitExecution`

Una línea `ProjectItem.quantity = 3` representa tres unidades físicas distintas a partir de armado.

Estados base:

```text
awaiting_parts
assembly
module_qc
packaged
loaded
installed
```

### OC-034 — migración de `ItemFloorStatus`

Mantener compatibilidad mientras dashboards/pantallas migran. `floorStatus` puede convertirse temporalmente en resumen derivado del estado de piezas/unidades.

---

## 7. Prioridad P1 — levantamiento y medidas

### OC-040 — `SiteSurvey`

Entidades/campos mínimos:

- revision;
- spaces;
- dimensiones;
- huecos/obstáculos;
- notas de plomo/nivel/escuadra;
- utilities si aplican;
- fotos;
- capturedBy/capturedAt;
- verifiedAt/verifiedBy.

### OC-041 — separar medidas por intención

Cuando aplique distinguir:

- preliminar/comercial;
- levantada;
- aprobada;
- fabricación.

Nunca permitir que una medida preliminar llegue a CNC por accidente sin gate.

---

## 8. Prioridad P1 — MRP ligero y compras

### OC-050 — `MaterialRequirement`

Deriva del BOM liberado, no de heurísticas del dashboard.

### OC-051 — reservas

Stock conceptual:

```text
onHand
reserved
available = onHand - reserved
incoming
required
shortage
```

### OC-052 — shortage → PO

Permitir generar/relacionar PO con faltantes reales y proyecto(s).

### OC-053 — ampliar PO

Prioridad alta:

- unit cost snapshot;
- requiredBy / expectedAt;
- allocation a obra;
- recepciones parciales.

Prioridad posterior:

- vendor SKU;
- moneda;
- documentos de recepción.

### OC-054 — material ready honesto

`materialsRelease` puede permanecer como aprobación humana, pero la UI debe mostrar la evidencia:

- reservado;
- recibido;
- faltante;
- override si alguien libera con faltantes.

---

## 9. Prioridad P1 — QC y retrabajo

### OC-060 — `QualityIssue`

Aplica antes de entrega y puede vincular pieza o mueble.

Categorías iniciales:

- dimensional;
- acabado/canto;
- mecanizado;
- daño;
- faltante;
- armado;
- otro.

### OC-061 — `ReworkAction`

Resoluciones:

```text
rework
refabricate
scrap
accept_as_is
```

Registrar material/tiempo afectado para job costing.

### OC-062 — QC gates

Antes de package/load, permitir checklist de QC por unidad y bloqueo configurable.

---

## 10. Prioridad P1 — instalación profesional

### OC-070 — `InstallationJob`

Una obra de instalación es un subproceso, no un único botón.

### OC-071 — `InstallationVisit`

Campos mínimos:

- fecha;
- crew;
- arrival/start/end;
- notas;
- fotos;
- unidades trabajadas;
- resultado.

### OC-072 — `FieldIssue`

Estados:

```text
open
action_required
blocked
resolved
verified
```

Debe permitir fotos y vínculo a mueble/pieza cuando corresponda.

### OC-073 — `PunchItem`

Pendientes posteriores a instalación con:

- owner;
- due date;
- severidad;
- bloqueador;
- evidencia de resolución.

### OC-074 — cierre/conformidad

Proyecto no pasa a `completed` por sólo marcar todos los muebles `installed` cuando existe punch abierto obligatorio.

---

## 11. Prioridad P1 — Job Costing

### OC-080 — `CostBaseline`

Basado en quote snapshot y revisión liberada.

### OC-081 — `TimeEntry`

Categorías iniciales:

- sales/design si se desea medir;
- engineering;
- cut;
- cnc;
- edge_banding;
- assembly;
- qc/rework;
- shipping;
- installation;
- warranty.

### OC-082 — material actual

Proviene de stock/receipt/consumo asignado a obra y scrap/rework.

### OC-083 — otros actuals

- flete;
- outsource;
- instalación externa;
- consumibles configurables.

### OC-084 — estimate vs actual

Vista mínima:

```text
Revenue
Estimated direct cost
Actual direct cost
Variance
Expected gross margin
Actual gross margin
```

---

## 12. Prioridad P1 — dashboards y UX operacional

### OC-090 — dashboards exception-first

El dashboard de dueño/gerente debe priorizar:

- fecha instalación en riesgo;
- faltantes;
- revisión stale;
- cola estancada;
- WIP alto;
- QC/rework;
- sobrecosto.

No añadir cards métricas sólo por llenar una pantalla.

### OC-091 — Proyecto como workspace transversal

Una obra debe ofrecer acceso coherente a:

```text
Overview
Sales
Survey
Design/Revisions
Engineering
BOM
Materials/Purchases
Production
Shipping
Installation
Costs
Files/Timeline
Warranty
```

La IA por departamentos sigue existiendo; el Project Workspace da continuidad transversal.

### OC-092 — experiencia por tamaño de taller

Small workshop: navegación simplificada.  
Medium business: navegación departamental completa.

RBAC y preferencias pueden compartir implementación.

---

## 13. Prioridad P1 — revisión de RBAC

### OC-100 — least privilege por estación

Revisar especialmente si `gerente_ventas` e `ingeniero` deben avanzar estados físicos de planta.

Principio objetivo:

- Ingeniería libera producción.
- Producción registra ejecución física.
- Gerentes pueden corregir/override con auditoría.

### OC-101 — operadores sin sectores

Migrar del legacy “sin asignación = full access” hacia configuración explícita/fail-closed una vez que los datos existentes estén normalizados.

---

## 14. Prioridad P2 / condicionada por piloto

Estas capacidades siguen siendo válidas pero no desplazan el core sin señal de cliente:

- reglas avanzadas sistema 32;
- export CNC específico de marca;
- editor visual avanzado de perforaciones;
- render premium;
- plugin SketchUp;
- marketplace de catálogos;
- forecasting avanzado;
- multi-planta complejo.

La excepción es una necesidad real confirmada de un taller piloto que haga cambiar la prioridad.

---

## 15. Orden recomendado de ejecución

### Ola 0 — documentación y guardrails

OC-001 → 006

### Ola 1 — lifecycle y release

OC-010 → 024

### Ola 2 — producción física pieza→mueble

OC-030 → 034

### Ola 3 — material + calidad

OC-050 → 062

### Ola 4 — instalación + cierre

OC-070 → 074

### Ola 5 — rentabilidad real

OC-080 → 084

### Continuo

- Site Survey (OC-040/041)
- UX/Project Workspace (OC-090+)
- pilotos con talleres

---

## 16. Estrategia de migración

### 16.1 Dual-write temporal

Cuando un evento nuevo represente una acción que hoy usa un stamp/flag, durante transición puede escribirse ambos:

```text
engineeringLog.startedAt + project_event(engineering_started)
materialsRelease + project_event(materials_ready)
```

Luego consumidores migran a eventos y el campo legacy se depreca.

### 16.2 Backfill

Datos viejos se migran conservadoramente:

- un timestamp conocido puede crear evento histórico marcado `source=backfill`;
- nunca inventar fecha desconocida;
- si sólo se conoce estado actual, no fabricar una cronología falsa.

### 16.3 Feature flags / adapters

Nuevos modelos físicos pueden coexistir con `ItemFloorStatus` mientras UI y API migran.

### 16.4 No migration-by-dashboard

Un dashboard nunca debe convertirse en el lugar donde se corrigen datos. Las fuentes deben arreglarse en dominio/storage y las métricas sólo leer.

---

## 17. Definition of Done del Operational Core v1

Operational Core v1 se considera logrado cuando:

- lifecycle comercial y operacional puede reconstruirse con eventos;
- existe Production Release vinculada a revisión/BOM;
- cambios post-release no se ejecutan silenciosamente;
- corte/CNC/enchape pueden seguir piezas individuales;
- armado produce unidades físicas trazables;
- stock diferencia disponible/reservado/faltante;
- QC/rework se registra;
- instalación admite visitas + punch;
- estimate vs actual existe por obra;
- dashboards no presentan proxies como hechos;
- CI remoto demuestra tests críticos;
- la documentación canónica coincide con el código o marca explícitamente el delta.
