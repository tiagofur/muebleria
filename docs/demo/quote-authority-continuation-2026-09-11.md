# Cotizaciones — continuación acotada de la autoridad comercial

**Fecha:** 2026-09-11.  
**Corte de código:** `main@25c2cbb55f86d379ffba9c47844ce850552b09f9`.  
**Estado de este documento:** plan de ejecución; no implementación ni nueva autoridad de dominio.  
**Dueños del trabajo:** #642, #644 y #643; seguimiento UI específico del mecanismo de #637.  
**Primer entregable:** detalle comercial coherente de una QuoteRevision exacta, dentro de #642.

Este plan continúa las entregas existentes. No activa otro escritor de producto, no autoriza merge/cierre y no modifica el alcance del frente PTX #650. Los agentes deben revalidar main, PRs abiertos, comentarios y reservas antes de ejecutar. La autorización y los límites de cada entrega siguen el proceso de #573.

## 1. Autoridades que se conservan

- [Digital Thread, especialmente §16A](../architecture/project-design-digital-thread.md): identidad física, revisiones, snapshot comercial y liberación exacta.
- [Integración SketchUp/Go/React](../architecture/sketchup-backend-web-integration-excellence.md): ownership por superficie.
- [Plan DEMO/MVP](../demo-mvp-plan-2026-09-05.md): objetivo integrado; sus cortes históricos no son estado actual permanente.
- [UI](../design.md), [UX operacional](../operational-ux.md) y [verificación](../verification.md).
- [Reporte de #642 Slice 2a](../../progress/implementation_642_quote_revision_consumers.md): evidencia histórica de cabecera/totales; no prueba de migración completa del cuerpo.

Código y tests definen lo implementado. Esta continuación aclara el inventario de pendientes; no duplica contratos OpenAPI ni reemplaza ADR-0003.

## 2. Baseline que no debe reimplementarse

| Entrega | Estado al corte | Límite |
|---|---|---|
| #635 / PR #636 | Integrada | URLs firmadas y recuperación de preview/descargas de Design. |
| #637 / PR #638 | Integrada | Detección/reparación explícita de materiales del working copy por API; sin nueva acción React. |
| #639 / PR #646 | Integrada | Descriptores históricos de nuevas DesignRevisions; legacy honesto. |
| #640 / PR #647 | Integrada | Salud/integridad de artefactos. |
| #641 / PR #648 | Integrada | Queries y accesibilidad del inspector de DesignRevision. |
| #642 / PR #649 | Integrada | Snapshot comercial inmutable y timestamps reales. |
| #642 / PR #653 | Integrada parcialmente | Cabecera, identidad, cantidad agregada, estado y totales del detalle; no todas las líneas/consumidores. |
| #644 / PR #645 | Integrada, tracker abierto | Golden Q1 → R1 → R2 → Q2 → aprobación/liberación; conserva una escritura auxiliar legacy que debe retirarse al corregir producto. |
| #650 / PRs #652, #654, #655, #656 | Integradas | Programa, optimizador, vista/instrucciones y núcleo PTX. |
| #650 / PR #657 | Abierto al consultar, no integrado | Puente CutProgram → PTX/readback; no contar como merge ni como conexión de adapter/descarga. |

Este documento no revisa ni aprueba #657. Su descripción declara refilados positivos y fases mayores a tres bloqueados; adaptar ese frente exige su propia evidencia. No se relajan gates de máquina ni se declara PTX terminado desde este plan comercial.

## 3. Inventario correcto de consumidores de #642

La fila de §16A que declara migrado el detalle se debe leer de manera acotada: **cabecera/totales/lifecycle de entrada**, no todo el cuerpo. La siguiente entrega actualizará esa tabla junto con su implementación y pruebas.

| Consumidor | Implementado al corte | Pendiente |
|---|---|---|
| Autoridad/caché del detalle | Revisión aceptada; en su ausencia, última exacta; caché por tenant/sesión | Mantener pin, respuestas tardías y errores honestos al extender consumidores. |
| Cabecera y totales | Snapshot de la revisión | Conservar sin fallback mutable. |
| Muebles/medidas/acabados del detalle | `ProjectItemsSection` lee `project.items` y catálogo actual | Presentación histórica desde la MISMA revisión y sus IDs estables. |
| Opciones/medidas globales/herramientas del detalle | Superficies del Project mutable | No presentarlas como parte de la revisión congelada; separar borrador de trabajo. |
| Lista/filtros/projectEstimates/Inicio/Ventas | Dependencias Project/priceSnapshot/cálculo vivo | Read model comercial coherente, sin N+1 por cada tarjeta. |
| Operaciones/eligibilidad export productivo | Dependencias legacy todavía inventariadas | Separar aceptación comercial, readiness y liberación exacta; no escribir accepted a escondidas. |
| PDF/XLSX y presentación al cliente | Pipelines del Project/catalog/settings actuales | Documentos de QuoteRevision exacta; no ampliar garantías del PDF legacy. |
| Costing | Consumidores por clasificar | Separar cotización histórica de costo operativo real. |

### Evidencia de código

- `apps/web/src/quoteRevisionAuthority.ts` devuelve la revisión y su snapshot.
- `apps/web/src/ShellView.tsx` pasa un resumen de autoridad y un Project independiente.
- `packages/ui/src/projects/components/ProjectItemsSection.tsx` usa `project.items` y módulos/opciones del catálogo mutable.
- `packages/ui/src/projects/ProjectsScreen.tsx` mantiene `productionExportOk` basado en Project.status. Su guard comercial sí bloquea edición de una revisión aceptada; el pendiente no se debe describir como ausencia total de bloqueo.
- `apps/web/src/exportCommercialQuotePdf.ts` continúa tomando Project/catalog y updatedAt.
- `tests/organization/demo-golden-path.spec.ts`, etapa 10, hace `saveProject({...stored, status: 'accepted'})` antes del release. Esto prueba que el golden actual incluye un atajo; no demuestra por sí solo qué comando backend depende de él. Reproducir sin la escritura antes de modificar producto.

## 4. Secuencia de implementación, sin tickets duplicados

### Entrega 1 — Detalle comercial exacto (#642)

**Resultado único:** cuando la pantalla muestre Q2, cabecera, cantidad, total y líneas describen Q2, no el Project actual.

- Reutilizar la revisión exacta del cliente generado y su commercialSnapshot.
- Agrupar mediante quoteLineId; vincular unidades/items mediante FurnitureInstanceId. No unir por nombre, posición en array o semejanza de medidas.
- Nombres/códigos/opciones desde los descriptores congelados; medidas/parámetros desde los items de ESA QuoteRevision. No usar DesignRevision/latest, defaults del módulo ni catálogo actual para completar historia.
- Permitir que unidades de una misma línea tengan parámetros distintos: mostrarlas sin aplanar una unidad arbitraria como representativa de todas.
- Cantidades activas y unidades removed/cancelled respetan el contrato existente; no revivir unidades terminales.
- Vista congelada de solo lectura. Q draft tampoco habilita editar el snapshot en memoria como si fuese persistencia.
- Mantener el flujo de preparación anterior a Q1: proyecto nuevo sin revisiones puede editar su borrador en un contexto expresamente no emitido. Preparar cambios futuros no equivale a editar Q aceptada. No crear un nuevo motor/editor de drafts en este incremento.
- Separar u ocultar controles del Project mutable dentro de la vista de revisión; nunca deshabilitar Proyectar globalmente por existir SketchUp ni implementar #643 aquí.
- Loading/error/legacy/stale no recuperan líneas, cantidades o etiquetas del Project como fallback. Ausencia comercial no equivale a un HTTP fallido. Cancelación/respuesta tardía no mezcla proyectos o tenants.
- Mostrar sólo importes ya autorizados por el contrato. No dividir total entre muebles, recalcular precios ni presentar importes redactados como cero comercial. La política de precios de venta sin costos se resuelve en la entrega de exportación/proyección comercial, sin debilitar #649.

**Frontera:** cambios Web/UI/presentación y tests, pequeño paso de props/contexto generado cuando haga falta; sin migrations, backend pricing, nuevas APIs, lista/dashboards globales, retiro transversal de lifecycle, exportadores, PTX, Proyectar o Ruby. Una brecha de contrato real se reporta como dependencia; no se inventa historia ni se rediseña la API por conveniencia.

**Pruebas de salida:**

1. Q1 tiene 600 mm; R2 cambia una unidad a 650 mm; se crea/publica/acepta Q2. Regreso a detalle muestra Q2 y 650 mm, aun cuando el Project mutable difiera.
2. Qty > 1 mantiene IDs físicos distintos, bindings y parámetros por unidad.
3. Renombrar módulo/material, cambiar precios/defaults y modificar/eliminar una línea actual no altera la lectura histórica de Q2.
4. Loading, failed, legacy, stale y cambio de proyecto/tenant no exponen datos de otra autoridad.
5. Antes de Q1 se puede preparar la cotización; después de Q2 accepted no aparece edición in-place del snapshot.
6. Componentes más navegador React + Go + PostgreSQL, responsive 390/768/1280, sin solo source-grep o mocks como prueba integral.

PR parcial con `Refs #642`. Mantener la issue abierta. No adelantar el resto de este plan en el mismo PR.

### Entrega 2 — Consumidores restantes y retiro comercial legacy (#642)

Migrar lista/filtros/Inicio/Ventas y clasificar costing/operaciones. Eliminar el segundo camino comercial de Enviar/Aceptar/Reabrir y sus dependencias visibles o silenciosas. Preservar Project como dueño de identidad y los eventos operativos legítimos.

No se exige conservar una segunda UX comercial para supuestos clientes legacy. Eso no autoriza borrar datos, reescribir migraciones aplicadas ni cambiar una revisión histórica. La compatibilidad técnica mínima debe quedar explícita y no accesible como bypass comercial.

El fin del doble accepted no es un sync de estados: Q accepted no significa Design approved ni autoriza automáticamente fabricar. Reusar aprobación/reconciliación y ProductionRelease exactos, con sus gates.

#644 acompaña la verificación: retirar la escritura auxiliar legacy sólo cuando el recorrido funcione y exista prueba negativa de que ningún helper/API/trigger crea una segunda aceptación oculta. Conservar #577 sin reiniciar su freeze/routing/stock.

### Entrega 3 — Documentos y proyección comercial (#642)

PDF/XLSX se generan desde la QuoteRevision exacta seleccionada: identidad, líneas, opciones, medidas, importes y timestamps históricos disponibles. Nombre/contenido del archivo identifica QN. Sin fallback live cuando falta snapshot. Golden semántico determinista; no exigir bytes idénticos de contenedores PDF/ZIP con metadata variable salvo normalización explícita.

Antes de prometer precios unitarios/importes completos a actores sin acceso a costos, definir proyección de venta que no revele costos internos ni muestre campos redactados como 0. No inferir precios desde el total global ni duplicar labor fijo.

§16A declara que el snapshot v1 no tiene impuestos runtime ni descuentos adicionales persistidos. Registrar esta limitación y decidir su alcance de producto antes de ampliar documentos. No fabricar IVA/descuentos en React ni añadir un subsistema fiscal implícito a la Entrega 1; tampoco declarar esos requisitos implementados por exportar un PDF.

### Verificación integral (#644)

Conservar #645 y extenderlo, no crear un runner nuevo. La historia de cambio comercial es Q1 → R1 → R2 → Q2 accepted → R2 approved → P1 exacto (Q2,R2). Un movimiento puramente espacial se verifica separadamente y puede conservar Q1 cuando lo autorice el dominio; no forzar recotización por numeración.

Exigir ausencia de pérdida de dimensiones/materiales como aserción, no solamente nota. Añadir prueba visible del detalle comercial y del retiro legacy conforme se integren las entregas. Nunca convertir tests de publicación por contrato en claims de ejecución real dentro de SketchUp.

## 5. Seguimientos independientes

### Interfaz para reconciliar materiales del working copy (#637, seguimiento nuevo)

El mecanismo de #638 se conserva cerrado como entrega backend/contrato. Un ticket UI dedicado debe permitir detectar, revisar y confirmar la reconciliación desde el Design exacto sin consola. Se reutilizan GET provenance y POST reconcile, permisos existentes, idempotencia y optimistic concurrency. Sin reparación automática al abrir una pantalla.

La fuente cotizada del endpoint actual es la línea current del Project: no etiquetarla como Q2 aceptada histórica si el contrato no aporta esa procedencia. Preservar authored/aliases, mostrar resultados reales por unidad y no afirmar atomicidad de lote si sólo hay comandos por unidad. Si falta un nombre histórico, no resolverlo silenciosamente con el catálogo actual.

La reparación modifica working copy; R1–R3 permanecen iguales. Publicar R4 es una acción posterior explícita, no un efecto automático de Reconciliar. Prueba browser/Go/PostgreSQL; smoke real-host separado y honesto. Esta UI no es prerequisite de la Entrega 1.

### Proyectar (#643)

Mantener P2/MVP y contrato independiente del estado comercial. Q accepted congela el compromiso, no prohíbe preparar una alternativa/cambio futuro. Una revisión SketchUp no deshabilita Proyectar en todo el Project.

Por Design debe existir un contexto canónico de trabajo: Project/Design/base, control de concurrencia sobre la working copy y handoff/fork explícito. No usar sólo baseRevisionId si no detecta dos escrituras de la misma working copy sin publicación intermedia; reutilizar el token de versión/concurrencia servidor que corresponda. No doble escritura permanente hacia ProjectKitchenLayout y Design.

Read-only/handoff ante un cliente incompatible debe ser contextual y explicado. No inventar paridad de geometría .skp ni un merge automático entre clientes.

### PTX (#650)

No se cambia su ticket ni sus archivos desde este trabajo. Terminar/revisar #657 y la conexión de perfil/adapter/descargas bajo su plan vigente. #348/campo, cinco cocinas y ejecución de máquinas siguen separados del cierre técnico solicitado. No declarar compatibilidad física por tests offline.

## 6. Documentación, aprobación y evidencia

Esta entrega sólo añade el plan y aclara el alcance del reporte de #653. Las issues se reconcilian después de publicar la documentación en rama; el PR documental queda para revisión humana, sin merge automático.

Cada PR de producto actualizará el inventario §16A y su reporte con lo efectivamente implementado, no con casillas aspiracionales. Las fuentes de arquitectura siguen siendo las existentes; no modificar retrospectivamente la evidencia exact-HEAD de los PRs cerrados.

Antes de empezar producto: leer AGENTS.md, #642/comentarios, las fuentes de §1 y el estado real del lane #650/#573. Un solo escritor, rama limpia aislada, sin stash/reset/clean destructivo ni commits de cambios ajenos. Si el lane PTX sigue reservado, respetar esa reserva; no asumir permiso para paralelizar.

Final de cada incremento: tests aplicables sobre SHA exacto, diff/check y readback remoto; reviewer independiente y CI exact-HEAD para readiness. No autoconceder status:approved/size:exception, no merge, no cierre de parent por una entrega parcial. Las limitaciones de host, receptor o infraestructura se reportan sin convertirlas en PASS.
