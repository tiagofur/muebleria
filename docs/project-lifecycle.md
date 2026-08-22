# Project Lifecycle — Eventos, gates y trazabilidad

**Estado:** CANÓNICO  
**Actualizado:** 2026-08-21

> Este documento distingue explícitamente **IMPLEMENTADO HOY** de **MODELO OBJETIVO**.
> No convertir una intención de este archivo en afirmación de código existente.

Documentos relacionados:

- `docs/prd-v2.md` — visión y alcance;
- `docs/operational-core-v1.md` — plan de implementación;
- `docs/production-flow-v2.md` — granularidad física pieza→mueble.

---

## 1. Principio

El ciclo de una obra debe poder reconstruirse con hechos auditables, no sólo con el
valor actual de varios flags.

> **Los eventos son append-only. Los estados visibles se derivan cuando sea posible.**

Todos los timestamps operativos usan ISO datetime con hora. Una fecha de calendario
puede existir para compromisos (`installationScheduledDate`), pero no reemplaza al
timestamp del hecho real.

---

## 2. Estado IMPLEMENTADO HOY

Actualmente el paso principal entre áreas se deriva mediante:

- `Project.status` (`draft | quoted | accepted | produced`);
- `engineeringLog`;
- `materialsRelease`;
- `ProjectItem.floorStatus` + `floorEvents` para ejecución física legacy;
- `cancelledAt` y otros stamps auxiliares.

`packages/domain/src/processStage.ts` implementa hoy:

```text
ventas       = draft/quoted
ingenieria   = accepted/produced sin sentToProductionAt
almacen      = sentToProductionAt sin materialsRelease
produccion   = materialsRelease presente
```

Esto es la **verdad ejecutable actual**, aunque sea un modelo transitorio.

### 2.1 Ingeniería actual

`EngineeringLog` registra actualmente:

```text
startedBy / startedAt
generatedBy / generatedAt
sentToProductionBy / sentToProductionAt
revision
```

`canSendToProduction()` valida hoy, en esencia:

```text
project accepted + engineering documented
```

### 2.2 Material release actual

Almacén registra un stamp `materialsRelease` con actor y timestamp. Éste habilita la
obra para el stage de producción actual.

### 2.3 Floor events actuales

Cambios de `ItemFloorStatus` pueden generar `FloorStatusEvent` append-only con actor,
fecha, source y nota. Esta disciplina se conserva y se extiende, pero la granularidad
de `ProjectItem` no es suficiente para Corte/CNC/Enchape; ver Production Flow v2.

---

## 3. Gaps conocidos del modelo actual

1. No existe aún un `ProjectEvent[]` completo y canónico.
2. `accepted` mezcla resultado comercial y entrada a trabajo técnico.
3. No hay `lost` comercial explícito.
4. Fecha de creación se usa en algunas métricas como proxy de hechos posteriores.
5. El gate de ingeniería documentado históricamente fue más rico que el
   `EngineeringLog` ejecutable.
6. `technicalStatus`, `ProjectStatus`, `ProjectProcessStage` y floor status pueden
   superponerse.
7. No existe todavía un `ProductionRelease` formal vinculado a design revision/BOM.
8. Instalación física no equivale todavía a closeout/punch/sign-off.

Estos gaps se implementan mediante `docs/operational-core-v1.md`.

---

## 4. MODELO OBJETIVO — Project Events

### 4.1 Forma conceptual

```ts
type ProjectEvent = {
  id: string;
  projectId: string;
  type: ProjectEventType;
  at: string;
  byUserId?: string;
  source?: 'web' | 'desktop' | 'mobile' | 'api' | 'backfill';
  note?: string;
  payload?: Record<string, unknown>;
};
```

El payload debe ser pequeño, versionable y no sustituir entidades complejas.

### 4.2 Eventos comerciales

```text
quote_created
quote_sent
quote_won
quote_lost
quote_expired
deposit_received
```

### 4.3 Survey / design / approval

```text
survey_started
survey_completed
design_revision_created
design_submitted
design_approved
design_changes_requested
change_order_created
change_order_approved
```

### 4.4 Ingeniería y release

```text
engineering_started
engineering_documented
production_released
production_release_revoked
```

### 4.5 Materiales

```text
materials_required
materials_reserved
materials_shortage_detected
materials_ready
materials_release_overridden
```

Los emite el subproceso de planificación de materiales de la obra (OC-050..054):
`materials_required` al derivar requerimientos del BOM liberado,
`materials_reserved`/`materials_shortage_detected` al reservar contra
disponibilidad, y `materials_ready` (+ `materials_release_overridden` cuando
hay faltantes) en la liberación con evidencia.

### 4.6 Producción/logística

El detalle de estación vive en ejecución de pieza/unidad; el proyecto recibe hitos:

```text
production_started
production_completed
shipment_loaded
shipment_departed
```

Calidad/retrabajo (OC-060..062): los defectos detectados antes de entrega y las
decisiones de retrabajo dejan hitos auditados (con costo de material/minutos en
el payload); la trazabilidad fina (categorías, resolución, QC por unidad) vive
en el quality job de la obra:

```text
quality_issue_reported
rework_started
```

Job costing (OC-080..OC-084, #304): el baseline congelado, el tiempo registrado
y los costos externos dejan hitos auditados; la trazabilidad fina (categorías
OC-081, tipos OC-083, valorización de consumo) vive en el costing job de la
obra. Las anulaciones son soft (void) con autor:

```text
cost_baseline_captured
cost_time_recorded
cost_other_recorded
cost_entry_voided
```

### 4.7 Instalación/cierre

```text
installation_started
installation_completed
punch_opened
punch_closed
client_signed_off
project_closed
warranty_opened
```

---

## 5. Commercial Status objetivo

El resultado comercial debe separarse de fabricación:

```text
draft
sent
won
lost
expired
cancelled
```

`won` no significa “ya se puede cortar”. Significa que el proceso técnico puede avanzar
según contrato/anticipo/workflow del taller.

Migración desde `ProjectStatus` debe ser aditiva y compatible; no big bang.

---

## 6. Project Stage objetivo

`ProjectStage` es una vista derivada para navegación/reportes:

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

No es el event log ni debe contener todos los detalles físicos.

---

## 7. Gate de Engineering → Production

### 7.1 Corrección de documentación histórica

La versión anterior de este documento afirmaba como regla que “Enviar a producción”
requería exactamente:

- Optimizer;
- lista de herrajes;
- CSV;
- etiquetas PDF.

Eso **no coincide con el contrato ejecutable actual**. Hoy el código tiene un concepto
más simple de “documented”. Por lo tanto esa lista deja de describirse como gate vigente.

### 7.2 Modelo objetivo: `ProductionRelease`

El gate robusto no debe depender únicamente de que “se generó un archivo”. Debe crear
una liberación explícita:

```ts
type ProductionRelease = {
  id: string;
  projectId: string;
  projectVersion: number;
  designRevisionId: string;
  bomFingerprint: string;
  releasedBy: string;
  releasedAt: string;
  checks: readonly ProductionReleaseCheck[];
};
```

Los checks pueden variar por workflow/taller, por ejemplo:

- cotización/contrato ganado;
- anticipo requerido recibido;
- levantamiento verificado;
- aprobación cliente;
- aprobación técnica;
- BOM válido;
- documentación mínima generada;
- no hay blockers críticos.

El producto puede exigir documentos concretos por configuración, pero el release es la
entidad canónica.

---

## 8. Revisión stale y cambios

Después de `ProductionRelease`, cualquier mutación que afecte fabricación debe poder
invalidar/revisar:

- BOM;
- cut plan;
- etiquetas;
- DXF/CNC;
- requirements/reservas;
- documentos.

No modificar silenciosamente una orden ya ejecutable.

Un cambio que afecte alcance/costo/plazo crea `ChangeOrder` y una nueva revisión.

---

## 9. Material Ready

### Hoy

`materialsRelease` es el stamp operacional que abre Producción.

### Objetivo

El stamp se apoya en evidencia derivada de:

```text
requirements
reservations
receipts
shortages
```

Un supervisor puede override con razón; el evento queda auditado.

---

## 10. Producción — relación con lifecycle

El lifecycle de proyecto no reemplaza ejecución física.

### Antes de Armado

Corte/CNC/Enchape: eventos/estados por **pieza**.

### Desde Armado

Armado/QC/Embalaje/Carga/Instalación: estados por **mueble/unidad/bulto**.

El proyecto deriva hitos agregados como `production_started/completed`.

Ver `docs/production-flow-v2.md`.

---

## 11. Instalación y cierre

`installed` de todas las unidades no obliga automáticamente a `project_closed`.

Según workflow, cierre puede exigir:

- field issues resueltos;
- punch cerrado;
- conformidad cliente;
- documentos/fotos finales;
- facturación final como integración futura.

Warranty ocurre después de cierre o entrega según la política comercial.

---

## 12. KPIs de tiempo

Cuando los eventos existan, medir:

| KPI | Desde | Hasta |
|---|---|---|
| Ciclo de venta | `quote_created` | `quote_won` / `quote_lost` |
| Tiempo a anticipo | `quote_won` | `deposit_received` |
| Espera Ingeniería | gate de entrada | `engineering_started` |
| Ciclo Ingeniería | `engineering_started` | `production_released` |
| Espera Material | `production_released` | `materials_ready` |
| Ciclo Producción | `production_started` | `production_completed` |
| Espera embarque | `production_completed` | `shipment_departed` |
| Instalación | `installation_started` | `installation_completed` |
| Cierre | `installation_completed` | `project_closed` |
| Lead time completo | `quote_created` | `project_closed` |

### Regla

No sustituir eventos ausentes por `createdAt` sin etiquetar el resultado como proxy.

---

## 13. Estrategia de migración

1. introducir tabla/collection de eventos;
2. dual-write acciones actuales a stamp + evento;
3. backfill sólo hechos inferibles con certeza, `source=backfill`;
4. migrar dashboards/KPIs;
5. derivar stage;
6. deprecar campos redundantes cuando no tengan consumidores ejecutables;
7. nunca inventar cronología de datos legacy.

---

## 14. Autoridades

- lifecycle intent: este documento;
- plan de implementación: `docs/operational-core-v1.md`;
- producción física: `docs/production-flow-v2.md`;
- implementación actual: `packages/domain/src/processStage.ts`, `engineering.ts`,
  `productionFloor*.ts` y backend equivalente;
- rutas: `apps/web/src/routes.ts`;
- permisos: RBAC ejecutable.

Si código y este documento difieren, marcar el delta como `implemented today` vs
`target`; no afirmar que uno ya cumple al otro sin evidencia.
