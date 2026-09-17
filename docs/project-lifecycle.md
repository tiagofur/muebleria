# Project Lifecycle — Eventos, gates y trazabilidad

**Estado:** CANÓNICO  
**Actualizado:** 2026-09-16

> Este documento distingue **IMPLEMENTADO en la base examinada** de **CORRECCIÓN OBJETIVO**.
> Base de la revisión: `556804c1cf57c79e064f3f32267634591b33dfbf`.
> #738 (entrada/navegación de Ingeniería) y #739 (despiece congelado/PTX de prueba)
> ya están integradas; #740 entrega su PR 1 (evidencia durable de Ingeniería por
> release) y mantiene el gate físico transversal como segunda entrega.

Documentos relacionados:

- `docs/prd-v2.md` — visión y alcance;
- `docs/roadmap-comercial-v2.md` — único orden de producto;
- `docs/architecture/project-design-digital-thread.md` + ADR-0003 — Q/R/P e identidad física;
- `docs/operational-core-v1.md` — fundamentos operativos;
- `docs/production-flow-v2.md` — granularidad física pieza→mueble;
- `docs/demo/engineering-flow-recovery-2026-09-15.md` — evidencia, entregas y pruebas del desbloqueo de Ingeniería/PTX.

---

## 1. Principio

El ciclo de una obra debe reconstruirse con hechos auditables, no sólo con flags.

> Los eventos son append-only. Las etapas visibles son proyecciones; no sustituyen la autoridad de los comandos.

**Una versión congelada no demuestra que una etapa física haya ocurrido.**

```text
QuoteRevision aceptada      = compromiso comercial exacto
DesignRevision aprobada     = decisión sobre un diseño exacto
ProductionRelease existente = contenido técnico autorizado y fijado
Ingeniería completa         = preparación técnica terminada para ese contenido
Material autorizado         = alcance abastecido/autorizado según evidencia
Producción iniciada         = trabajo físico efectivamente comenzado
```

Automatizar validaciones, selección inequívoca, sincronización y readback no autoriza aceptar, aprobar, liberar o completar etapas sin intención y permisos. Una acción compuesta sólo puede ejecutar consecuencias mostradas y autorizadas, mediante los commands existentes y con recuperación de fallos.

Timestamps operativos incluyen hora y actor del hecho real. Una fecha de compromiso no sustituye ese evento; nunca usar createdAt como hecho posterior sin marcar proxy.

---

## 2. Estado IMPLEMENTADO en la base examinada

### 2.1 Autoridades modernas existentes

- QuoteRevision tiene snapshot comercial y comandos create/publish/accept; accepting puede superseder la Q anterior sin reescribir su contenido.
- Design tiene WorkingCopy mutable y revisiones históricas publicadas/aprobadas.
- ProductionRelease canónico fija referencias exactas y tiene snapshot/routing congelados. No es el blob legacy `Project.productionRelease`.
- Los lectores de fabricación/material planning ya disponen de autoridad canónica; la derivación de requerimientos exige P exacta cuando corresponde.
- Existen eventos de proyecto, ejecuciones por pieza/unidad, QC, material planning, instalación, pendientes, conformidad y closeout. El listado de gaps del 2026-08-21 que decía que estas foundations no existían queda superado.

Fuentes: `backend-go/internal/domain/quote_commercial.go`, `production_release.go`; `internal/storage/production_release_authority.go`, `partExecutions.go`, `materialPlanning.go`; `internal/api/installation.go`.

### 2.2 Etapas — contradicción de la base examinada, corregida por #738

En la base examinada (`556804c1`), `packages/domain/src/processStage.ts`
implementaba:

```text
si Project.status no es accepted/produced → ventas
si no sentToProduction                   → ingenieria
si no materialsRelease                   → almacen
si materialsRelease                      → produccion

sentToProduction = engineeringLog.sentToProductionAt O release canónico
```

A la vez, `releaseAuthority.ts#projectAllowsProductionAccess` habilitaba el
hub con release canónico aunque Project.status fuera draft: la obra podía
abrir Producción y seguir clasificada como Ventas, o saltar Ingeniería con
un accepted antiguo + P.

#738 (implementado) unificó la proyección ejecutable que cola, métricas y
workspace consumen:

```text
ventas       = cancelada (cancelledAt), o sin release canónico y
               (draft/quoted, o accepted/produced sólo pre-DT/local)
ingenieria   = release canónico presente sin evidencia material
               release-correlacionada (cualquiera sea Project.status),
               o accepted/produced legacy sin sentToProductionAt
almacen      = canónico: requerimientos congelados derivados del release
               exacto; legacy: sentToProductionAt sin materialsRelease
produccion   = canónico: derivación + autorización de materiales
               release-scoped (stamp auditado); legacy: materialsRelease
```

- Un `ProductionRelease` canónico habilita la **preparación** de Ingeniería;
  por sí solo no la completa, no libera materiales ni inicia fabricación.
  Sólo la evidencia material CORRELACIONADA con la P exacta avanza la obra
  (`materialEvidenceCorrelatesWithRelease`): el snapshot de requerimientos
  debe llevar el `releaseId` de la autoridad resuelta Y su huella de BOM
  (`bomFingerprint` = `manufacturingFingerprint`); la autorización
  release-scoped escribe el stamp sobre esa derivación. Requerimientos de
  otra P, sin identidad o con huella incompatible — y un stamp legacy sin
  derivación correlacionada — jamás avanzan la autoridad actual (P2 no
  hereda la etapa operativa de la evidencia de P1). La finalización durable
  de Ingeniería por release es #740.
- La cadena legacy aplica SÓLO a contexto pre-Digital-Thread positivamente
  identificado (`hasDigitalThreadContext === false`). El servidor proyecta
  el campo en toda lectura del API y los productores locales (seed,
  repositorio local, creación en modo guest) lo declaran positivamente: el
  modo local es DT-free por construcción. Procedencia desconocida
  (`undefined`) falla cerrado — un payload que nadie avaló no obtiene etapa
  fabril a partir de stamps antiguos, ni en la etapa ni en
  `canReleaseMaterials`.
- `sentToProduction` sólo refleja el handshake legacy OC-022
  (`engineeringLog.sentToProductionAt`); "existe P" ya no se interpreta
  como envío ya realizado.
- `engineeringEntryStatus` proyecta el estado honesto de preparación para
  las superficies de Ingeniería: `pending` (sin evidencia), los estados del
  log legacy, o `unverified` (release canónico + log legacy no
  correlacionado — evidencia que no prueba la finalización de esa
  liberación y no se borra).
- Proyectos modernos (`hasDigitalThreadContext === true`) con stamp residual
  accepted/produced y sin release fallan cerrado. La ausencia de proyección
  (`undefined`) es modo local, no evidencia pre-DT: la cadena legacy se
  conserva para el modo local/pre-DT positivamente identificado (`false`).
- El acceso de consulta/operación al hub de Producción es otra regla
  (`projectAllowsProductionAccess`, #697): consultar el hub no es lo mismo
  que haber completado Ingeniería.

Ese comportamiento era un defecto, no una invariante: #738 corrige entrada/navegación (arriba); #740 completa las decisiones operativas.

### 2.3 Ingeniería actual

EngineeringLog vive por proyecto y registra:

```text
startedBy / startedAt
generatedBy / generatedAt
sentToProductionBy / sentToProductionAt
revision
```

El envío antiguo exige Project accepted + documented y escribe produced antes de fabricar. No interpreta correctamente una finalización por P exacta. No reutilizar ese stamp para completar automáticamente Ingeniería de un nuevo release.

**Estado durable por release (#740, primera entrega IMPLEMENTADA):** la tabla
`production_release_engineering` (migración 000134, tenant-owned + RLS
owner-org, transiciones protegidas por trigger) registra la evidencia de
Ingeniería ligada al release EXACTO: ausencia = `pending`; una fila
`in_progress`/`completed` con actor y timestamp del servidor. Comandos:

```text
POST /projects/{id}/production-releases/{releaseId}/engineering:start      (idempotente)
POST /projects/{id}/production-releases/{releaseId}/engineering:complete   (final, If-Match)
GET  /projects/{id}/production-releases/{releaseId}/engineering            (sólo lee)
```

`complete` exige inicio previo, la evidencia de routing congelado (schema v2)
del mismo release y la versión esperada; auditoría de seguridad y evento de
lifecycle (`engineering_started`/`engineering_completed`) se escriben en la
misma transición. Ningún comando toca Q/R/P, materiales, ejecuciones ni
`Project.status`; leer nunca escribe. El read model del proyecto proyecta el
estado de Ingeniería del release AUTORIDAD (`release_engineering`); el
workspace consulta el del release pineado. P2 nace genuinamente `pending` —
nunca hereda timestamps, actor ni completion de P1. El `engineeringLog`
legacy queda intacto como compatibilidad pre-DT (sin migrar; un log sin
procedencia release-scoped sigue `unverified` en la proyección de #738).

El cableado de Ingeniería en `apps/web/src/ShellView.tsx` todavía calcula despiece, etiquetas y herrajes desde Project/catalog actuales. #739 adapta el input congelado para despiece/optimización/candidatos; #682 conserva la propiedad de reimpresiones/QR históricos.

### 2.4 Materiales y ejecución actuales

Material planning conserva requerimientos con procedencia exacta; el release de materiales registra evidencia/override y un stamp en Project. Picking realiza stock, estado y consumo con solicitudes separadas; #680 corrige esa atomicidad.

El guard de ejecución canónica valida P/R/fingerprint y routing congelado. Esa comprobación no equivale a validar Ingeniería terminada/material autorizado. #740 requiere reproducir cada ruta física por HTTP y cubrir sus escritores, no sólo botones.

**RED operacional reproducido (#740 PR 1) e invertido (#740 PR 2, PostgreSQL +
HTTP reales):** con Q/R/P válidos y SIN Ingeniería completada ni materiales
autorizados, avanzaban el trabajo físico: `POST /parts/{partId}/advance`
(pieza → operación completada, floor event), `PATCH /items/{itemId}/floor-status`
y `POST /floor-scan` (item quote-line → `cut`/`edged`), y el side-effect de
`POST /production/activity/finish` movía el floor status sin resolver autoridad
de release. Desde el PR 2 todos esos writers fallan cerrado (409 con motivo
accionable) y dejan 0 mutaciones — la suite `engineering_physical_gate_red_test.go`
conserva el escenario con la expectativa INVERTIDA y
`engineering_physical_gate_test.go` cubre la matriz completa (§ más abajo).

**Gate operacional transversal (#740 PR 2) — la regla ejecutable vigente:**

```text
Trabajo físico permitido
= ProductionRelease exacto (autoridad vigente)
+ Ingeniería COMPLETA para ese release (production_release_engineering)
+ materiales AUTORIZADOS para ese MISMO release
  (material_planning.Requirements pina release + manufacturing fingerprint
   Y MaterialPlanning.Release evidencia presente — liberación regular
   o excepción autorizada auditada; ambas conservan actor/timestamp/alcance)
+ los gates técnicos existentes (P/R/fingerprint, routing congelado v2,
  secuencia, permisos por sector, QC)
```

La autoridad común vive en `backend-go/internal/storage/physical_work_gate.go`
(`authorizePhysicalWork`), se resuelve DENTRO de la transacción del writer bajo
el lock `FOR UPDATE` de la fila de `projects` (los comandos de Ingeniería y de
materiales toman el mismo lock → la decisión y la mutación comparten frontera,
sin TOCTOU), y se cablea en:

| Writer | Clasificación | Camino |
|---|---|---|
| `POST /parts/{partId}/advance` | trabajo físico | `MutateProjectPartExecutions` |
| `POST /units/{unitId}/advance` | trabajo físico | `MutateProjectPartExecutions` |
| `POST /units/{unitId}/assembly-override` | trabajo físico (override ≠ puerta trasera) | `MutateProjectPartExecutions` |
| `POST /parts/{partId}/rework` | trabajo físico | `MutateProjectPartExecutions` |
| `POST /quality/rework`, `/quality/qc/{unitId}[/override]` | trabajo físico | `MutateProjectQualityPhysical` |
| `PATCH /items/{itemId}/floor-status` | trabajo físico (bypass confirmado, cerrado) | `SetProjectItemFloorStatusGated` (atómico con su evento F092) |
| `POST /floor-scan` | trabajo físico (bypass confirmado, cerrado) | `SetProjectItemFloorStatusGated` |
| `POST /production/activity/finish/{id}` | telemetría sin efecto físico; actividades con efecto físico terminan en UNA transacción storage (finish + floor + F092 bajo el lock del proyecto con el gate; cualquier error hace rollback de TODO — corrección de revisión: sin brecha preflight/mutación) | `FinishProductionActivityWithPhysicalEffect` |
| `PUT /projects/{id}` (agregado) | NO es canal físico para obras canónicas: `part_instances`/`module_units` ya se congelaban (#577); ahora también se preservan `floor_status` por item y se descartan `floor_events` del cliente | handler del PUT |

Además, cada avance exige que la pieza/unidad PERTENEZCA al release vigente
(`ProductionRevision == authority.ReleaseID`): evidencia de P1 nunca autoriza
avanzar trabajo de P2 ni viceversa (P2 completamente re-preparado sigue
rechazando avanzar piezas de P1 — blocker de liberación anterior).

**Clasificación preparación vs ejecución (documentada, §12):** generación de
ejecuciones PLANIFICADAS (`PUT /part-executions`, incluida regeneración
supervisada con `force`), abrir/consultar Ingeniería, despiece congelado,
optimización, guardado de plan y descarga PDF/PTX (#738/#739) siguen
disponibles ANTES de Ingeniería completa/materiales — generar un plan o
descargar un archivo NO es producción iniciada y no descuenta stock. Reportar
un problema de calidad y su ciclo administrativo (transiciones de issue) son
observación, no avance físico. Claim de actividad y reporte de daño son
telemetría/observación.

**Compatibilidad pre-DT (explícita):** proyectos sin release canónico no tienen
identidad de release que correlacionar y conservan su cadena OC-022 (el gate no
aplica); esa compatibilidad NUNCA habilita un proyecto moderno — cualquier
release canónico hace canónica la autoridad y activa el gate. Los blockers del
gate se mapean a 409 con copy accionable ("Ingeniería pendiente…" /
"Material pendiente de autorización…" / "el trabajo pertenece a una liberación
anterior…"); React los muestra verbatim (toast) — la visibilidad de pantallas
NO es el gate, el backend manda.

### 2.5 Pruebas históricas que se conservan

#642/PR #663 entregó detalle comercial exacto. PR #673 retiró el auxiliar `saveProject({status:'accepted'})` del golden path. PR #697 prueba acceso al hub con Project draft; no prueba Ingeniería/Almacén completos. #731/PR #735 automatizó validación/publicación del diseño en SketchUp, no aceptación comercial ni fabricación.

Estos hechos no deben volver a aparecer como trabajo pendiente por leer checklists antiguos. Nuevas pruebas se ejecutan contra su HEAD real; no se hereda PASS de un PR histórico.

---

## 3. Correcciones pendientes y ownership

| Issue | Responsabilidad |
|---|---|
| #738 | Entrada, cola y navegación de Ingeniería sin Project.status ni salto implícito. |
| #739 | Despiece congelado y preparación de PDF/PTX de prueba desde P exacta. |
| #740 | ENTREGADO (PR 1 + PR 2): evidencia durable de Ingeniería por release exacto, comandos start/complete y gate operacional transversal de avance físico con Ingeniería completa y material autorizado del mismo release, bajo lock y con correlación exacta. |
| #741 | P1/P2 en trabajo iniciado, suspensión/cancelación sin retarget ni pérdida de historia. |
| #642 | Continuación de consumidores comerciales, Q/R sencilla, export comercial y retiro de autoridad comercial legacy. |
| #679 | Refresco entre clientes y escritura de WorkingCopy con detección de cambios concurrentes. |
| #680 | Despacho/reversión atómicos e idempotentes. |
| #682 / #683 | Etiquetas históricas y posventa/refabricación exactas, respectivamente. |
| #644 | Verificación incremental del recorrido integrado, sin implementar producto. |

#736/PR #737 corrige colisiones de piezas/routing durante la liberación; al preparar esta revisión su PR estaba abierto, no integrado en la base. No duplicar esa causa en #738/#739. Verificar su estado al ejecutar.

---

## 4. Project Events y vocabulario

Reutilizar el event log y las entidades existentes. No crear otro dispatcher/event store ni hacer que un evento de refresco de UI sea un comando de negocio.

La forma conceptual continúa siendo:

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

El payload es pequeño y versionado; las referencias a Q/R/P y unidades son exactas. Los nombres siguientes son vocabulario de integración, no una afirmación de que todos tengan un writer implementado.

### 4.1 Comercial

`quote_created`, `quote_sent`, `quote_won`, `quote_lost`, `quote_expired`, `deposit_received` se alinean con el writer comercial vigente. No crean otro CommercialStatus editable que compita con QuoteRevision.

### 4.2 Survey / diseño / decisiones

`survey_started`, `survey_completed`, `design_revision_created`, `design_submitted`, `design_approved`, `design_changes_requested`, `change_order_created`, `change_order_approved` mantienen su ámbito. Publicar no aprueba; aceptar un cambio comercial no fabrica ni revoca P.

### 4.3 Ingeniería y release

Distinguir publicación/creación de P del comienzo y finalización de Ingeniería. #740 define la evidencia durable y su proyección sobre los eventos existentes. Un nombre como production_released no demuestra corte iniciado. Production release revocation no se anuncia implementada: el contrato canónico examinado sólo tiene active.

### 4.4 Materiales

`materials_required`, `materials_reserved`, `materials_shortage_detected`, `materials_ready`, `materials_release_overridden` proceden de planificación y sus commands. Deben expresar release/alcance y conservar la diferencia entre disponibilidad, reserva, recepción, despacho y autorización con excepción.

### 4.5 Producción/logística y calidad

El detalle vive en ejecución por pieza/unidad. Los hitos de proyecto, donde estén soportados, resumen hechos tales como `production_started`, `production_completed`, `shipment_loaded` o `shipment_departed`; no se generan sólo por abrir un workspace.

`quality_issue_reported` y `rework_started` conservan trazabilidad de defecto, decisión y coste. Una modificación local de estado no reemplaza el comando de ejecución/QC autorizado.

### 4.6 Costing

`cost_baseline_captured`, `cost_time_recorded`, `cost_other_recorded`, `cost_entry_voided` conservan la autoridad de #304. Las anulaciones preservan historia y actor; no se introduce contabilidad fiscal en el desbloqueo de Ingeniería.

### 4.7 Instalación/cierre

`installation_started`, `installation_completed`, `punch_opened`, `punch_closed`, `client_signed_off`, `project_closed` corresponden a los workflows existentes. Garantías y refabricación conservan su owner; no se infiere warranty_opened de la mera existencia de una obra cerrada.

---

## 5. Resultado comercial

QuoteRevision es autoridad comercial exacta; Project conserva identidad y preocupaciones operativas legítimas. No sincronizar QuoteRevision.accepted hacia Project.status ni crear un segundo camino Enviar/Aceptar/Reabrir.

El vocabulario histórico draft/sent/won/lost/expired/cancelled puede servir a presentación según evidencia disponible. No equivale al enum ni a los commands actuales de QuoteRevision, ni autoriza un nuevo aggregate paralelo.

Medidas, materiales, precios y documentos comerciales históricos proceden de la Q seleccionada. IVA/descuentos requieren contrato explícito: no inventar campos ni cálculos fiscales en UI/export. Una estimación de diseño no es otra Q ni reescribe la aceptada.

---

## 6. Etapa operacional OBJETIVO

La etapa se deriva de hechos de cada contexto, con pendientes/bloqueos visibles. No persistir un mega-status para suplir la ausencia de autoridad.

```text
Ventas / diseño
→ cotización aceptada + diseño compatible aprobado
→ P exacta disponible
→ Ingeniería pendiente / en proceso / completa
→ abastecimiento y autorización de materiales
→ trabajo físico autorizado / iniciado
→ operaciones por pieza
→ armado / QC / empaque por unidad
→ entrega / instalación
→ conformidad / cierre
```

La cola de un área y la lectura histórica no son lo mismo. Una obra puede consultar documentos anteriores sin volver a su etapa anterior. Preparación de compras puede adelantarse como estimación explícita; no simula material disponible.

---

## 7. Liberación técnica e Ingeniería

### 7.1 ProductionRelease existente

La forma canónica es la de `backend-go/internal/domain/production_release.go` y el contrato generado, no el antiguo ejemplo OC-022 con projectVersion/bomFingerprint.

P fija diseño/base comercial donde aplique y manufacturing fingerprint, con snapshot resuelto asociado. Conserva los controles de aprobación, reconciliación, preflight, tenant y concurrencia. Crear P no implica Ingeniería terminada, stock despachado ni una máquina compatible.

### 7.2 Finalización de Ingeniería — PRIMERA ENTREGA IMPLEMENTADA (#740)

#740 registra finalización sobre P exacta, con evidencia de preparación requerida y actor/timestamp. No existe una lista universal obligatoria Optimizer + CSV + etiquetas para todos los casos. La política mínima del alcance soportado se declara; resultados faltantes/incompatibles bloquean esa finalización.

**Implementado (PR 1 de #740):** la comprobación objetiva mínima de
preparación es la evidencia de routing congelado (schema v2) del MISMO
release — sin ella `complete` falla cerrado (`engineering_routing_unavailable`).
Descargar PDF/PTX o guardar el plan NO completa Ingeniería: la confirmación es
siempre una acción explícita del usuario autorizado
(admin/gerente_produccion/ingeniero). La UI muestra
Pendiente → En proceso → Completa con CTAs contextuales y, al completar, el
hecho (actor/fecha del servidor) más la etapa siguiente honesta
(«autorización de materiales (pendiente)») — sin habilitar materiales ni
trabajo físico (el gate transversal pertenece a la segunda entrega de #740).

Si preparar Ingeniería descubre un cambio del contenido a fabricar, no se edita P1: se vuelve a autoría/revisiones y se obtiene la nueva autorización correspondiente.

### 7.3 Generación de archivos de prueba

#739 permite preparar el candidato soportado desde Ingeniería antes de completar Ingeniería o abastecimiento. Esto evita el ciclo imposible «necesito terminar Ingeniería para generar el documento necesario para terminarla».

El candidato utiliza datos congelados de P y parámetros explícitos de plan/perfil; conserva NOT_TESTED/notClaimed hasta evidencia externa. No exige stock ni registra progreso. La fabricación real y los claims de compatibilidad mantienen sus gates bajo #740/#348/#503.

---

## 8. Revisión stale y cambios

Una nueva R no modifica P1. Un cambio de fabricación requiere revisar su autorización y artefactos; nunca reemplazar silenciosamente BOM, cut plan, etiquetas, DXF/CNC, requerimientos o documentos.

#741 define continuidad de trabajo P1 al aparecer P2. La existencia de P2 no migra piezas en curso, reservas, QC o Ingeniería. Hasta tener reemplazo parcial probado, bloquear la transición no soportada y ofrecer revisión explícita sin borrar evidencia.

#678 gobierna Change Orders post-aceptación; no exigir completar ese aggregate para un candidato PTX de prueba que ya puede usar una Q/R/P válida.

---

## 9. Material autorizado

### Implementado

Material planning deriva requerimientos exactos y evalúa reservas/stock con liberación y excepción auditada. Existe además materialsRelease en Project y picking por proyecto/categoría. La secuencia multi-request de despacho sigue bajo #680.

### Corrección OBJETIVO

#740 exige correlación de evidencia con el release/alcance del trabajo. «Material completo» no describe una liberación con faltantes. Reservado, recibido, despachado y autorizado no son sinónimos.

Primera política completa por release; un alcance parcial no implementado se identifica y bloquea. No construir lotes universales ni reescribir inventario en el gate. La transacción de despacho y reversión pertenece a #680.

---

## 10. Producción — preparación frente a ejecución

Generar ejecuciones planificadas puede ser una operación de preparación. Iniciar/avanzar una operación física exige el gate operativo además del routing, permisos, revisión y QC actuales. #740 inventaría todas las entradas API, no sólo el botón normal.

Corte/CNC/Enchape trabajan piezas conforme al routing exacto. No imponer una secuencia única por el nombre de una pantalla. Armado consume piezas listas y desde allí se siguen unidades/bultos:

```text
awaiting_parts → assembly → module_qc → packaged → loaded → installed
```

No usar Project.status=produced como prueba de fabricación completa. Ver `docs/production-flow-v2.md`.

---

## 11. Instalación y cierre

Installed de todas las unidades no equivale automáticamente a project_closed. Los commands existentes distinguen completar instalación, conformidad y cierre, con verificaciones de unidades, visitas, incidencias y pendientes.

Fotos/documentos finales y facturación futura no deben inventarse como gates actuales. Warranty puede seguir entrega/cierre según política; #683 añade procedencia exacta de refabricación sin reconstruir el módulo.

---

## 12. KPIs de tiempo

Medir hechos del mismo contexto; los eventos ausentes se muestran missing o proxy explícito.

| KPI | Desde | Hasta |
|---|---|---|
| Ciclo comercial | Creación/publicación exacta según la métrica | Aceptación/resultado comercial exacto |
| Espera Ingeniería | Disponibilidad del contexto técnico P | Inicio de Ingeniería para P |
| Ciclo Ingeniería | Inicio de Ingeniería para P | Finalización de Ingeniería para P |
| Espera de material | Demanda final del mismo contexto | Autorización del alcance requerido |
| Ciclo productivo | Primer inicio físico del trabajo | Finalización física comprobada |
| Instalación | Inicio de instalación | Instalación completada |
| Cierre | Instalación completada | Conformidad y cierre |

No usar la creación de P como finalización de Ingeniería ni la fecha de Project como fecha de aceptación. #740 provee los hechos pendientes, no este documento.

---

## 13. Estrategia de transición

1. Preservar Q/R/P, snapshots, eventos e identidades existentes.
2. Añadir sólo referencias/hechos/commands necesarios, con contrato generado, tenant classification, RLS y auditoría.
3. Publicar una proyección coherente y migrar consumidores, evitando escrituras paralelas permanentes.
4. Evidencia histórica sólo se adopta si su procedencia es demostrable; de otro modo revisión explícita. No backfill ficticio.
5. Retirar writers legacy cuando sus reemplazos estén probados; no borrar migraciones aplicadas ni proyectos del usuario.
6. Validar fresh/upgrade/direct-SQL, idempotencia/concurrencia y el browser real; rollback no pierde progreso ni cambia releases.

---

## 14. Autoridades y evidencia

- Identidad/revisiones: Digital Thread + ADR-0003.
- Semántica lifecycle: este documento; ejecución física granular: production-flow-v2.
- Orden de producto: roadmap-comercial-v2; backlog operativo: GitHub issues.
- Implementación actual: código en el HEAD indicado; una issue abierta puede contener entregas parciales.
- Verificación: #644 y suites existentes; SketchUp real y receptor de máquina son capas separadas.

El merge de documentación no corrige runtime ni demuestra que una prueba de cliente haya pasado. Actualizar la sección IMPLEMENTADO sólo con readback de código y evidencia del alcance real.
