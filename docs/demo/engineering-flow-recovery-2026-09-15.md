# Recuperación del flujo Q/R → Ingeniería → PTX de prueba

> Fecha: 2026-09-15. Base examinada: `556804c1cf57c79e064f3f32267634591b33dfbf`.
> Estado: PLAN DE CORRECCIÓN; no implementación ni certificación de la demo.
> Prioridad solicitada por el propietario: simplificar Q/R y desbloquear Ingeniería para preparar PTX de prueba.
> El único orden de producto vive en [roadmap-comercial-v2.md](../roadmap-comercial-v2.md). Este documento explica entregas y evidencias, no crea otro backlog/dispatcher.

**Avance (2026-09-16):** A (#738) y B (#739) integradas. C completada en dos PRs:
el **PR 1 de #740** entregó la evidencia durable de Ingeniería por release exacto
(tabla `production_release_engineering` + comandos `engineering:start`/`:complete`
idempotentes/versionados + proyección del read model) con el **RED operacional**
conservado. El **PR 2 de #740** invirtió ese RED e implementó el **gate
operacional transversal** (`storage/physical_work_gate.go`): todo writer de
trabajo físico exige, para el release EXACTO y bajo el lock de la fila del
proyecto, Ingeniería `completed` + autorización de materiales correlacionada
(liberación regular o excepción autorizada auditada), SUMADO a los gates
técnicos existentes; las piezas/unidades deben pertenecer al release vigente
(evidencia de P1 nunca autoriza trabajo de P2); el PUT agregado deja de ser
canal físico (floor_status/F092 del cliente se descartan en obras canónicas); y
la preparación (despiece congelado, optimización, plan, PDF/PTX de #739)
sigue disponible antes de la autorización. La regla final vive en
`docs/project-lifecycle.md` §2.4 y `docs/architecture/project-design-digital-thread.md` §25.9.

## 1. Resultado inmediato y límites

```text
Diseñar en SketchUp
→ publicar el diseño (con validación automática existente)
→ resolver sólo diferencias comerciales que requieren decisión
→ confirmar cotización/diseño exactos mediante los comandos existentes
→ crear o recuperar el release exacto
→ abrir Ingeniería
→ leer despiece congelado de ese release
→ optimizar
→ descargar PTX de prueba y PDF del mismo plan
```

Llegar a Ingeniería y generar un candidato NO exige simular que terminó Ingeniería, liberar materiales, despachar stock, iniciar corte ni marcar `Project.status=accepted/produced`. No requiere completar todo el ERP, #678, #679 ni la evidencia de campo de #348. Sí exige contenido técnico resoluble, permisos, contexto exacto y capacidad real de serialización. No hay bypass del preflight ni fallback a un formato genérico.

La prueba de receptor/cliente permanece separada: candidato descargable `NOT_TESTED/notClaimed` no es archivo autorizado para ejecución física. Preparar/descargar el candidato no crea evidencia de compatibilidad, órdenes de máquina ni avance de fabricación.

## 2. Evidencia y correcciones al diagnóstico anterior

Las observaciones siguientes son estáticas sobre la base indicada; no se ejecutaron en esta revisión pruebas PostgreSQL, SketchUp ni máquinas.

| Hecho | Fuente verificable en el repositorio | Consecuencia |
|---|---|---|
| `projectProcessStage` retorna ventas para `Project.status=draft`, incluso con release canónico | `packages/domain/src/processStage.ts` | Una obra moderna liberada no entra en la cola de Ingeniería. |
| `sentToProduction` considera suficiente un release canónico | mismo archivo | Con un stamp antiguo accepted puede saltar Ingeniería sin un trabajo terminado. |
| Acceso al hub de Producción admite release canónico independientemente de Project.status | `packages/domain/src/releaseAuthority.ts` | Acceso de lectura y etapa operativa no usan la misma interpretación. |
| La cola de Ingeniería filtra por `projectProcessStage` | `packages/ui/src/engineering/EngineeringScreen.tsx` | El defecto no se resuelve sólo cambiando el texto de un botón. |
| Ingeniería calcula despiece, etiquetas y herrajes desde Project/catalog actuales | `apps/web/src/ShellView.tsx`, rama `navId === 'engineering'`; `packages/domain/src/engine/cut.ts` | Hacer visible la pantalla no prueba que sus piezas sean las de P1. |
| `engineeringLog` es por proyecto; el envío antiguo escribe produced | `apps/web/src/stores/projectStore.ts`, `packages/domain/src/engineering.ts` | No es evidencia de Ingeniería completa para una liberación específica. |
| El guard de ejecución canónica valida snapshot/routing congelados | `backend-go/internal/storage/production_release_authority.go`, `partExecutions.go` | No demuestra por sí mismo autorización operativa de Ingeniería/materiales. Se exige prueba HTTP negativa antes del fix. |
| La resolución operacional selecciona el release con mayor número | `production_release_authority.go` | P2 podría cambiar la autoridad utilizada por comandos sobre trabajo P1; falta reproducir la carrera y fijar política. |
| WorkingCopy PUT reemplaza ítems bajo lock sin versión esperada de trabajo | `backend-go/internal/api/designs.go`, `internal/storage/designs.go` | Lock transaccional no equivale a rechazo de una copia obsoleta; continuidad bajo #679, no nueva issue de sync. |
| Picking realiza movimientos, estado y consumo en solicitudes distintas | `apps/web/src/stores/purchasingStore.ts` | Atomicidad pertenece a #680; no rehacer MRP en esta corrección. |

**No reiniciar entregas realizadas:**

- #642 / PR #663 ya entregó el detalle comercial de Q exacta; no volver a reemplazarlo.
- PR #673 retiró el `saveProject({status:'accepted'})` auxiliar de `demo-golden-path.spec.ts`. El texto antiguo de #644 que lo daba por presente está desactualizado. Conservar esa negativa, no repetir la implementación.
- PR #697 incorporó el happy path de reconciliación y acceso al hub con Project en draft. Abrir el hub no prueba Ingeniería/abastecimiento/fabricación completos.
- #577 ya tiene snapshot/routing y requerimientos canónicos. Cambiar sus consumidores; no construir un segundo BOM ni otro release.
- #731 / PR #735 ya contiene validación automática del diseño en SketchUp. No devolver al usuario la verificación mueble por mueble.
- #727 / PR #728 corrigió dimensiones explícitas frente a presets.
- #736 tiene PR #737 abierto al preparar este plan; corrige IDs repetidos y paridad de routing/preflight. Su descripción afirma pruebas, pero no estaba integrado en la base examinada. No repetirlo ni tomar su checklist como merge. Revalidar al comenzar; sólo los fixtures que necesiten esa corrección tienen esa dependencia técnica.

## 3. Contrato de experiencia: menos decisiones, no menos integridad

Q, R y P siguen siendo referencias técnicas exactas; no se renumeran, fusionan ni sustituyen por un estado global. Las acciones deben hablar de la tarea: «Publicar diseño», «Actualizar cotización», «Confirmar», «Preparar fabricación» o «Abrir Ingeniería», usando el vocabulario existente cuando sea suficiente.

- Una acción principal por intención. Identificadores, fingerprints y selectores históricos secundarios viven en historial/detalle técnico.
- Preselección sólo desde relaciones exactas y clasificación autoritativa. Numeración, fecha o nombre no prueban compatibilidad Q/R.
- Movimiento espacial permitido no genera una Q nueva. Cambio comercial se estima automáticamente, pero crea una Q nueva únicamente mediante intención explícita y el escritor existente.
- Conservar por separado guardar/sincronizar, publicar, aceptar, aprobar y liberar. Automatizar preparación, validación, selección inequívoca y refresco no autoriza efectos empresariales ocultos.
- Una confirmación compuesta futura sólo puede orquestar comandos existentes si muestra todas sus consecuencias, respeta cada capability, fija el par exacto y maneja retries/fallo parcial sin éxito fantasma. No es requisito para desbloquear Ingeniería.
- Cambios posteriores no reescriben Q/R/P previas. Ausencia de historial o permisos no se rellena con el catálogo actual ni con un total cero.

Esta continuación comercial pertenece a #642; HUD/Presentación a #677, refresco/conflictos entre clientes a #679 y Change Orders posteriores a aceptación a #678.

## 4. Entregas acotadas

Los identificadores GitHub de las nuevas correcciones se registran en el roadmap y en sus cuerpos. Las letras identifican límites técnicos, no una segunda cola de trabajo.

### A — Entrada y navegación de Ingeniería (P0)

Corregir proyección de cola/etapa y navegación post-release con Project en draft. P exacta permite preparar Ingeniería, no la completa. No escribir accepted/produced ni crear ingeniería/materiales/avance al consultar o navegar. Conservar lectura histórica y tratar progreso existente sin inventar hechos: cualquier migración de evidencia requiere autoridad comprobable.

La primera entrega puede limitarse a acceso/lectura y estados honestos: no necesita implementar aún la finalización durable de Ingeniería. Datos o exports canónicos no adaptados quedan bloqueados/identificados, nunca se hacen pasar por el release. A por sí sola no acredita el recorrido PTX; éste requiere B.

### B — Despiece congelado y candidato PTX desde Ingeniería (P0)

> **Estado (2026-09-15, PR #750 + evidencia completa sobre `d5d6dbbd`): IMPLEMENTADO.**
> `GET /projects/{id}/production-releases/{releaseId}/cutting-demand` expone la proyección
> tenant-safe del snapshot privado (identidad/cantidades/medidas/espesor/material/veta/cantos);
> Despiece y Optimización consumen esa base exacta con preparación editable (disco/refilados/
> estrategia/formato como inputs versionados del plan, `CutPlan.releaseBase` pinea
> P/R/fingerprint y persiste por-release); el mismo plan alimenta PDF y PTX/ZIP reales —
> PDF sin validar máquina, PTX respetando perfil/programa (#591/#650) con manifiesto que
> ahora lleva `productionReleaseId`/`designRevisionId`/`bomFingerprint`. Bloqueos concretos
> por formato y acción; catálogo divergente no reconstruye la demanda; material/canto
> ausente y snapshot faltante fallan accionable. Correcciones de revisión (PR #755):
> guardado verificable (el éxito se declara sólo con escritura confirmada; un fallo de
> storage se comunica como "puede perderse al recargar"), gate explícito
> legacy/canonical-loading/error/ready que exige la base verificada para generar y
> exportar (un plan previo de otra liberación no queda exportable mientras la nueva
> base carga o falla) y DXF canónico bloqueado mientras sus perforaciones dependan
> del proyecto vivo. Verificado con browser real
> Chromium+Go+PostgreSQL (Q1 600 → R2 650 → Q2/P1, PDF byte-exacto — consistencia
> contra el mismo generador, no revisión independiente de geometría —, readback PTX
> independiente) y suites Go/TS completas. Limitación declarada: el plan persiste
> por-release en localStorage del navegador (no compartido entre usuarios/equipos);
> etiquetas de material y espesor de canto son inputs del catálogo vigente. Lo no
> cubierto aquí sigue en sus owners:
> finalización/gates físicos (#740), continuidad P1/P2 (#741), etiquetas/QR (#682).

Consumir `GetProductionReleaseManufacturingSnapshot` y lectores existentes del release exacto; exponer sólo la proyección tenant-safe generada que falte. Usar los componentes/optimizer/preview/PDF/PTX/ZIP actuales. Ninguna reconstrucción productiva desde Project mutable, current catalog, un preset aproximado o defaults 18 mm/0.45 mm.

Conservar identidades de unidad y ocurrencia de pieza, cantidades, dimensiones, espesores efectivos, material, veta y cantos. Datos de formato de tablero y parámetros de optimización que no estén congelados en P deben capturarse explícitamente con versión/hash en el plan; no fingir que formaban parte del release. Un mismo material no equivale a un único formato de stock.

El plan fija P/R/fingerprint y la huella de sus inputs. Selección de P2, otra organización o cambio de inputs invalida el plan aplicable; no reasigna ni borra silenciosamente el anterior. El resultado PTX/PDF consume el mismo programa de corte y el perfil/adapter exacto de #650/#591. Una receta no representable o sin datos produce bloqueo útil.

Este es un slice de consumidor/entrada de Ingeniería, relacionado con #503, no una reescritura Go del optimizador ni nuevo serializer. Reimpresiones/QR completos siguen #682; rutas documentales no adaptadas no pueden aparentar autoridad P. No requiere compras, material release ni finalización de Ingeniería para preparar archivos de validación.

### C — Finalización de Ingeniería y autorización física exactas (P0 de seguridad operativa)

Reutilizar entidades/eventos/commands, añadir únicamente evidencia durable que falte: comienzo/finalización de Ingeniería ligada a P y autorización de materiales del mismo contexto. El timestamp real y el actor provienen del servidor. Un Project PUT o stamp anterior no puede fabricar esa evidencia.

Distinguir generar ejecuciones planificadas de iniciar/completar una operación física. El segundo caso exige readiness operacional validado en servidor bajo lock. Inventariar scanner, avance manual, claim/finish, overrides y transiciones legacy; no basta deshabilitar botones. No exigir aprobación de máquina validada para un PTX de prueba ni usar su descarga como prueba de Ingeniería completa.

Primera política: alcance completo del release. Si autorización parcial no está implementada, se informa y bloquea ese caso; no inventar un framework de lotes. Las excepciones permitidas conservan motivos/permisos y se muestran como excepciones, nunca «material completo». #680 conserva stock/picking atómico.

### D — Continuidad P1/P2, suspensión y cancelación (P1)

No seleccionar `latest` como autorización de un trabajo en curso. Revalidar la autoridad exacta de piezas/unidades y decisiones operativas. P2 no hereda Ingeniería/materiales de P1 ni borra progreso, reservas o artefactos. Hasta contar con reemplazo parcial probado, bloquear el retarget de trabajo en curso y explicar la resolución manual autorizada.

**Estado (2026-09-17, PR 1 de #741 ENTREGADO):** el primer incremento de
esta entrega está implementado — el trabajo materializado conserva su release
(pre-guard de pertenencia en todos los writers físicos bajo el mismo lock que
el gate de #740, la pregunta «¿a qué P pertenece ESTE trabajo?» precede a
cualquier evidencia de preparación), la regeneración bajo una autoridad más
reciente se bloquea con progreso físico o compromiso de material (ni force
reemplaza: no existe reconciliación), la discontinuidad limpia (ejecuciones
vírgenes sin compromiso) sigue disponible como preparación, P1 permanece
legible sin mutaciones, P2 nace limpio y la UI de Producción informa sin
ofrecer reemplazo automático. Detalle ejecutable en
`docs/project-lifecycle.md` §2.4 y `docs/architecture/project-design-digital-thread.md`
§25.10. Quedan para incrementos siguientes: reemplazo parcial/matching,
compensaciones (#680) y suspend/resume/cancel completos con el contrato
`suspend ≠ cancelación comercial`, `cancel trabajo ≠ revocar P`,
`resume ≠ crear P nueva`.

Suspender/reanudar/cancelar trabajo registra una decisión auditada y detiene nuevas acciones según política; no muta el contenido histórico de P ni simula una revocación canónica ya existente. Cancelación no crea automáticamente devoluciones de stock. Las compensaciones usan el dueño de inventario #680. Migración sin evidencia de procedencia falla cerrada, preservando datos para revisión.

## 5. Evidencia mínima por entrega

| Prueba | Resultado requerido |
|---|---|
| Project draft + Q aceptada + R aprobada + P1 | Obra visible en Ingeniería; no «fabricada», ni material completo implícito. |
| Q aceptada sin R/P compatible | Siguiente acción comercial/técnica correcta; ninguna autorización fabril falsa. |
| Refrescar/reabrir una URL de Ingeniería | Mismo P exacto; 0 mutaciones empresariales por GET/navegación. |
| Q1 600 mm → R2 650 mm → Q2/P1; Project/catálogo divergentes | Despiece y candidato usan P1/R2, no 600 mm heredados. |
| Dos unidades iguales, componentes/agregados repetidos | Identidades distintas, ninguna pérdida/duplicación de demanda. |
| Ingeniería no completada y almacén vacío | Candidato de prueba preparable; acciones físicas bloqueadas cuando C se integra. |
| Mismo plan/perfil/input | PTX determinista; lector independiente #650 comprueba geometría/jerarquía/cantidades. |
| Nueva R, P2 o cambio de formato/kerf | Artefacto/plan histórico no cambia; elección nueva explícita y sin retarget. |
| Otro tenant/sesión y respuestas tardías | No filtran datos ni aplican respuesta sobre otro contexto. |
| Fallo de snapshot/API/serializer | Error accionable y cero fallback productivo o éxito fantasma. |
| Avance por HTTP sin autorización operativa | Rechazo y cero mutaciones físicas; no sólo test de UI. |

Reutilizar `tests/organization/demo-golden-path.spec.ts`, `demo-flow-happy-path.spec.ts` y el gate existente bajo #644. Una ampliación de fixture no implementa producto. Tests Go/TS/OpenAPI/RLS/concurrencia según frontera; PostgreSQL y Chromium reales para claims de persistencia/UX; host SketchUp y receptor de máquina reportados por separado. No marcar PASS lo no ejecutado.

## 6. Orden y coordinación

1. Revisar/publicar/mergear humanamente #737 si sigue siendo el bloqueo del release de la muestra; no interferir con su writer.
2. A → B → extensión de #644: primer hito útil, Ingeniería y PTX de prueba sin estados falsos.
3. C antes de mostrar o usar acciones de fabricación física; D antes de operar P2 sobre trabajo iniciado. #680 antes de usar despacho real como parte del recorrido.
4. Continuar simplificación comercial #642/#677 y conflictos/refresco #679 sin nuevos sistemas paralelos. No esperar sus programas completos para A/B cuando los contratos necesarios ya existen.
5. #682 y #683 conservan etiquetas históricas y posventa. Instalación/QC/closeout existentes se verifican más adelante; no se reconstruyen en el desbloqueo PTX.

Un writer de producto, PRs acotados y revisión independiente; esta planificación documental no toma una reserva de producto. No merge/cierre/protected-label automático, no datos reales alterados ni scripts one-off contra la DB del propietario.

## 7. Criterio de salida del hito inmediato

El propietario abre su proyecto liberado desde la UI normal, llega a Ingeniería, ve piezas exactas, optimiza y descarga el candidato PTX sin consola, SQL, estados falsos ni reconstrucción con datos actuales. La evidencia identifica commit, P/R/Q, plan y perfil/adapter. Compatibilidad externa y ejecución física siguen sin afirmarse mientras no se prueben en sus propias fronteras.
