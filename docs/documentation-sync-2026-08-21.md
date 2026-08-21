# Documentation Sync Audit — 2026-08-21

**Propósito:** registrar explícitamente dónde la documentación histórica quedó atrás del código o dónde el código actual no cumple todavía la intención documentada. Este archivo es una fotografía de reconciliación, no una fuente de producto por sí sola.

---

## 1. Resumen

El producto evolucionó mucho más rápido que sus documentos originales. El problema no es que la documentación sea mala; gran parte fue correcta en el momento en que se escribió. El problema es que varias afirmaciones antiguas siguen leyéndose como si fueran actuales.

La solución adoptada es:

- conservar documentos históricos útiles;
- marcar cuál fuente es canónica hoy;
- documentar deltas implementado vs intención;
- evitar que agentes futuros “corrijan” código moderno para volver a un alcance antiguo.

---

## 2. Mismatches confirmados

### DS-01 — PRD original: “no CAD / no nesting / no ERP”

**Documento histórico:** `docs/history/prd.md`.

**Estado real:** la app ya tiene Proyectar 2D/3D, ambientes, CRM/RBAC, ingeniería, almacén, compras, producción por estaciones, mobile companion, nesting nativo, DXF y CNC en evolución.

**Resolución:** `docs/prd-v2.md` pasa a ser contrato narrativo actual. `docs/history/prd.md` queda como baseline MVP/histórico.

---

### DS-02 — Product context todavía describe sólo catálogos→cotización→Optimizer

**Documento:** `docs/PRODUCT.md`.

**Estado real:** la app ya cubre un flujo mucho más amplio.

**Resolución:** actualizar `docs/PRODUCT.md` para reflejar la plataforma operativa actual y referenciar Operational UX.

---

### DS-03 — Arquitectura documenta principalmente BOM→Excel

**Documento:** `docs/architecture.md`.

**Estado real:** hay bounded contexts funcionales de Sales, Engineering, Inventory/Procurement, Production, Logistics, Installation y After Sales.

**Resolución:** ampliar el contrato arquitectónico con ownership por contexto y estrategia de autoridad TS/Go.

---

### DS-04 — Production module dice que no hay nesting nativo

**Documento:** `docs/production-module.md`, baseline 2026-08-06.

**Estado real:** F115/F124–F126 implementaron cut-plan nativo, estrategia guillotina vs CNC nesting y export DXF.

**Resolución:** conservar el documento como baseline histórico y declarar `docs/production-flow-v2.md` + código actual como autoridad para el flujo físico moderno.

---

### DS-05 — `ItemFloorStatus` mezcla piezas y muebles

**Código actual:** `pending → cut → edged → assembled → packaged → loaded → installed` a nivel `ProjectItem`.

**Problema:** Corte, CNC y Enchape trabajan piezas; Armado entrega muebles completos.

**Resolución aprobada:** `docs/production-flow-v2.md` define la migración a `PartExecution` antes de Armado y `ModuleUnitExecution` desde Armado.

---

### DS-06 — CNC existe como sector pero no como etapa física completa

**Código:** `ProductionSector` contiene `cnc`, pero el pipeline legacy no tiene `machined` y el propio código lo reconoce como futuro.

**Resolución:** la ruta por pieza debe derivarse de operaciones requeridas y no de un enum lineal único.

---

### DS-07 — Lifecycle documentado es más rico que el lifecycle ejecutable

**Documento:** `docs/project-lifecycle.md` propone `ProjectEvent[]`, `deposit_received` y un gate detallado.

**Código real:** el stage se deriva de `ProjectStatus`, `engineeringLog` y `materialsRelease`; el event log completo sigue pendiente.

**Resolución:** Operational Core prioriza `ProjectEvent[]`, `CommercialStatus`, `ProjectStage` derivado y eventos reales de anticipo.

---

### DS-08 — Gate “Enviar a producción” no coincide con implementación

**Documento:** requiere cuatro documentos concretos.

**Código:** `canSendToProduction()` comprueba aceptación + ingeniería `documented`; `EngineeringLog` real no mantiene el mapa completo descrito en el documento.

**Resolución:** reemplazar conceptualmente el gate documental por `ProductionRelease` explícito con checks configurables; no afirmar que los cuatro documentos son hoy gate ejecutable hasta implementarlo.

---

### DS-09 — `technicalStatus`, `ProjectStatus`, `ProjectProcessStage` y floor status se solapan

**Problema:** varias máquinas de estado pueden producir combinaciones contradictorias.

**Resolución:** separar estado comercial, stage derivado y ejecución física; deprecar gradualmente los campos redundantes cuando los consumidores migren.

---

### DS-10 — Engineering Dashboard usa proxies como hechos

**Código actual:** `depositAtMs = createdAtMs`; `cutPieceCount = moduleCount * 8`.

**Resolución:** Resuelto en OC-006 (Data Truth Contract: `actual | estimated | forecast | proxy | missing`). Heurísticas etiquetadas explícitamente como proxy en domain y UI.

---

### DS-11 — Warehouse Dashboard usa proxies de consumo

**Código actual:** fallback por módulo para m², ml y herrajes; `daysInWarehouse` basado en `createdAt`.

**Resolución:** Resuelto en OC-006 (Data Truth Contract). Subtítulos y KPIs en UI declaran procedencia estimada (~2.8 m²/mód, ~14 ml/mód) vs calculada real.

---

### DS-12 — Picking contiene deuda de persistencia

**Código:** `ProjectPickingState` todavía documenta partes como no persistidas/MVP mientras stock/PO ya viven en servidor.

**Resolución:** reconciliar picking con movimientos/reservas y requirements reales durante la ola MRP.

---

### DS-13 — Inventory no modela reserva/disponibilidad

**Código actual:** `quantity + minStock` y ledger de movimientos.

**Gap de producto:** falta distinguir `onHand`, `reserved`, `available`, `incoming`, `required`, `shortage`.

**Resolución:** Operational Core OC-050–054.

---

### DS-14 — Installation actual es `loaded → installed`

**Código:** `InstalacionesScreen` trabaja muebles cargados y los marca instalados.

**Gap:** faltan visitas, crew, field issues, punch y cierre formal.

**Resolución:** OC-070–074.

---

### DS-15 — Warranty está más avanzado que Installation

**Estado:** warranty ya tiene tickets, fotos, categorías, prioridad, técnico, refabricación y reinserción a corte.

**Implicación:** conservar este diseño; llevar instalación/QC al mismo estándar de trazabilidad.

---

### DS-16 — Quote costing no equivale a Job Costing

**Estado actual:** `QuoteBreakdown` + snapshot de costos estimados.

**Gap:** no hay actual material/labor/rework integrado por obra.

**Resolución:** OC-080–084.

---

### DS-17 — Roles TS divergentes

**Código:** `UserRole` y `ProductRole` no contenían exactamente los mismos valores (`gerente_produccion`, `almacen`).

**Resolución:** Resuelto en OC-004. `UserRole` y `ProductRole` consolidados como alias idénticos con los 8 roles canónicos en TS y Go.

---

### DS-18 — RBAC permite avance físico a roles discutibles

**Código actual:** supervisores, `gerente_ventas` e `ingeniero` pueden avanzar estaciones físicas.

**Resolución:** revisión least-privilege. Ingeniería libera; producción registra ejecución; overrides de supervisor son auditados.

---

### DS-19 — Legacy access de producción sin sectores

**Código:** operador `produccion` sin sectores asignados puede conservar full access.

**Resolución:** migrar a asignación explícita/fail-closed después de normalizar datos.

---

### DS-20 — `init.sh` no prueba exactamente lo que afirma

**Código:** fallback de instalación termina con `|| true`; pnpm ausente puede no fallar el gate.

**Documento:** `docs/verification.md` trata `./init.sh` verde como evidencia fuerte.

**Resolución:** OC-001; después actualizar contrato de verificación.

---

### DS-21 — Falta CI remoto observable en main reciente

**Estado observado:** commit reciente sin status checks/workflow runs asociados mediante GitHub.

**Resolución:** OC-002; convertir tests críticos en checks remotos obligatorios.

---

### DS-22 — Issues abiertos pueden estar obsoletos frente al código

**Ejemplos observados:** issues históricos de CORS y varias features que ya muestran implementación en código/feature ledger.

**Resolución:** reconciliación de backlog, no asumir que issue abierto = feature ausente.

---

### DS-23 — CORS issue histórico ya no describe el middleware actual

**Código actual:** allowlist de origins + `Vary: Origin`, sin wildcard.

**Acción:** cerrar/reclasificar issue antiguo una vez validado con test actual.

---

### DS-24 — Login/refresh serializan `domain.User`

**Código actual:** `LoginResponse.User domain.User` y respuesta con `*u`; storage carga `PasswordHash`.

**Riesgo:** aunque un tag JSON pueda impedir fuga, el contrato es frágil.

**Resolución:** DTO público explícito + test que prohíbe secretos.

---

### DS-25 — JWT en query string para media

**Código actual:** middleware acepta `?token=` para `<img>`.

**Riesgo:** tokens en URLs/logs/historial.

**Resolución:** deuda de seguridad documentada; migrar hacia URL firmada/media token/fetch autenticado.

---

## 3. Documentos históricos que NO deben borrarse
- `docs/history/prd.md` — decisiones y baseline MVP;
- `docs/history/production-module.md` — historia y reasoning del workspace;
- `docs/history/app-excellence.md` — referencia histórica;
- `docs/history/*` — judgment days y auditorías;
- roadmap comercial v2 — conservar decisiones comerciales anteriores, pero actualizar prioridad vigente.

La estrategia es **supersede + link**, no borrar memoria del proyecto.

---

## 4. Nueva jerarquía documental

1. `docs/prd-v2.md` — qué producto construimos ahora.
2. `docs/operational-core-v1.md` — qué falta para consolidarlo.
3. `docs/production-flow-v2.md` — regla física pieza→mueble.
4. `docs/project-lifecycle.md` — lifecycle/eventos.
5. `docs/architecture.md` — ownership/boundaries.
6. `docs/design.md` + `docs/operational-ux.md` — UX/UI.
7. `docs/roadmap-comercial-v2.md` — prioridad comercial.
8. código/tests — implementación actual.
9. `feature_list.json` — ledger histórico/ejecutable.
10. GitHub issues — backlog operativo.

---

## 5. Regla para agentes futuros

Si un documento histórico contradice código moderno y una fuente canónica v2:

- no revertir código moderno por defecto;
- verificar la fuente ejecutable;
- abrir/actualizar discrepancia;
- implementar migración sólo desde una decisión documentada;
- no inventar que algo está “done” si sólo existe en intención.
