# Historial documental de Granete — Índice y guía de navegación

Este directorio conserva la memoria histórica, auditorías de punto en el tiempo (snapshots),
juicios de diseño (Judgment Days) y baselines fundacionales del proyecto Granete.

> **Regla de oro:** La historia explica el porqué del pasado; no es la verdad operativa del presente.
> No cargues este directorio como contexto inicial rutinario para implementar tareas.
> Consultá únicamente los documentos históricos específicos cuando necesites entender la evolución de una decisión o rescatar evidencia de una auditoría.

---

## 1. Qué contiene este directorio

1. **Baselines fundacionales:** Especificaciones originales que dieron origen al MVP inicial y a la primera etapa multi-usuario (ej. [`prd.md`](prd.md), [`production-module.md`](production-module.md)).
2. **Paquetes de auditoría profunda:** Informes integrales de salud del repositorio congelados en commits inmutables, con evidencias de pruebas y dashboards (ej. [`muebles-audit-360-20260903/`](muebles-audit-360-20260903/audit/README.md)).
3. **Registros de Judgment Days:** Minutas y resoluciones de revisiones exhaustivas de producto y arquitectura realizadas entre julio y agosto de 2026.
4. **Diagnósticos pre-rediseño y pantallas archivadas:** Memorias técnicas de problemas de UI resueltos y planes de pantallas de taller (ej. [`diagnostico-ui-pre-rediseno.md`](diagnostico-ui-pre-rediseno.md), [`roadmap-screens/`](roadmap-screens/00-overview.md)).
5. **Planes y checklists históricos de ingeniería:** Registros de hitos de desarrollo previos a la adopción de G-ODD (ej. [`projectar-super-3d-plan.md`](projectar-super-3d-plan.md), [`cut-plan-implementation.md`](cut-plan-implementation.md)).

---

## 2. Qué NO contiene este directorio

- **NO contiene la especificación operativa vigente:** El código fuente, los tests automatizados que pasan en `main`, los contratos generados (OpenAPI, DTOs de Go y TypeScript) y los documentos vivos bajo [`docs/architecture/`](../architecture.md) definen el comportamiento actual.
- **NO contiene las decisiones de arquitectura activas:** Los Architecture Decision Records (ADRs) residen en [`docs/adr/`](../adr/README.md).
- **NO contiene la bitácora operativa de tareas en curso:** Los artefactos recuperables de trabajo sustancial residen en [`odd/tasks/`](../../odd/tasks/README.md).
- **NO contiene la bitácora append-only previa a G-ODD:** El registro histórico cronológico de sesiones de la era anterior reside en [`progress/history.md`](../../progress/history.md) y sus artefactos en [`progress/archive/`](../../progress/archive/).
- **NO autoriza cambios funcionales:** Un informe o plan histórico jamás autoriza por sí solo un cambio de código o comportamiento en el producto.

---

## 3. Catálogo e inventario de registros históricos

### 3.1 Baselines y producto fundacional
| Documento | Fecha | Estado histórico | Sucesor canónico vigente |
| --- | --- | --- | --- |
| [`prd.md`](prd.md) | 2026-07-15 | MVP implementado (supersedido) | [`docs/prd-v2.md`](../prd-v2.md) |
| [`production-module.md`](production-module.md) | 2026-08-06 | Fases 0–4 implementadas | [`docs/production-flow-v2.md`](../production-flow-v2.md), [`docs/project-lifecycle.md`](../project-lifecycle.md) |
| [`roadmap-rn-v1.md`](roadmap-rn-v1.md) | 2026-08-15 | Roadmap preliminar React Native | [`docs/mobile-architecture.md`](../mobile-architecture.md) |

### 3.2 Auditorías y revisiones integrales
| Directorio / Documento | Fecha | Commit auditado | Descripción / Acceso |
| --- | --- | --- | --- |
| [`muebles-audit-360-20260903/`](muebles-audit-360-20260903/audit/README.md) | 2026-09-03 | `316df57c` | Auditoría 360° con evidencias JSON y dashboard web (`index.html`). |
| [`review-perfect-app-2026-07-29.md`](review-perfect-app-2026-07-29.md) | 2026-07-29 | Snapshot | Revisión de usabilidad y estabilidad de la app de escritorio/web. |
| [`issues-101-102-103.md`](issues-101-102-103.md) | 2026-07-17 | Snapshot | Análisis y resolución de issues fundacionales #101, #102 y #103. |

### 3.3 Juicios de diseño (Judgment Days)
| Documento | Fecha | Área evaluada | Resoluciones destacadas |
| --- | --- | --- | --- |
| [`judgment-day-ui-2026-07-17.md`](judgment-day-ui-2026-07-17.md) | 2026-07-17 | Interfaz de usuario | Unificación de diseño previa a Fase 3. |
| [`judgment-day-wip-3d-2026-07-17.md`](judgment-day-wip-3d-2026-07-17.md) | 2026-07-17 | Visor 3D Proyectar | Requisitos de rendimiento y escena 3D inicial. |
| [`judgment-day-2026-08-04.md`](judgment-day-2026-08-04.md) | 2026-08-04 | Arquitectura global | Alineación general de backend y frontend. |
| [`judgment-day-agregados-2026-08-11.md`](judgment-day-agregados-2026-08-11.md) | 2026-08-11 | Agregados de muebles | Especificación de complementos y herrajes adicionales. |
| [`judgment-day-app-2026-08-13.md`](judgment-day-app-2026-08-13.md) | 2026-08-13 | App shell | Jerarquía de navegación y menús principales. |
| [`judgment-day-catalogos-2026-08-19.md`](judgment-day-catalogos-2026-08-19.md) | 2026-08-19 | Catálogos | Modelo de materiales, cantos y accesorios. |
| [`judgment-day-shell-2026-08-19.md`](judgment-day-shell-2026-08-19.md) | 2026-08-19 | Layout & Shell | Implementación de barra lateral y tabs de segundo nivel. |
| [`judgment-day-compras-almacen-2026-08-20.md`](judgment-day-compras-almacen-2026-08-20.md) | 2026-08-20 | Compras y stock | Flujo de abastecimiento de materia prima. |

### 3.4 Diagnóstico de UI y especificación de pantallas
| Documento | Fecha | Estado | Propósito |
| --- | --- | --- | --- |
| [`diagnostico-ui-pre-rediseno.md`](diagnostico-ui-pre-rediseno.md) | 2026-08-18 | Resuelto | Memoria de los 8 problemas de UX y 8 de UI corregidos en el rediseño v2. |
| [`roadmap-screens/`](roadmap-screens/00-overview.md) | 2026-08-17 | Plan de pantallas | Especificaciones detalladas de pantallas de taller (ventas, ingeniería, fábrica, compras, almacén). |

### 3.5 Planes históricos y checklists
| Documento | Fecha | Propósito |
| --- | --- | --- |
| [`app-excellence.md`](app-excellence.md) | 2026-08-17 | Meta-issue #132 para robustez y calidad de la aplicación. |
| [`cut-plan-implementation.md`](cut-plan-implementation.md) | 2026-08-17 | Registro de integración con algoritmos de optimización de corte. |
| [`projectar-super-3d-plan.md`](projectar-super-3d-plan.md) | 2026-08-15 | Plan de desarrollo para el motor de renderizado 3D de Proyectar. |
| [`projectar-smoke-checklist.md`](projectar-smoke-checklist.md) | 2026-08-15 | Lista de verificación manual previa a releases del visor 3D. |
| [`proyectar-3d-slices-desarrollo-2026-08.md`](proyectar-3d-slices-desarrollo-2026-08.md) | 2026-08-28 | Slices de implementación incremental de Proyectar 3D. |

---

## 4. Cómo localizar decisiones arquitectónicas

Las decisiones formales del proyecto **no se buscan en este directorio de forma primaria**, sino en [`docs/adr/`](../adr/README.md).
- Si un documento histórico menciona un acuerdo preliminar (ej. en un Judgment Day), verificá si fue formalizado como un ADR (ej. ADR-0001 a ADR-0010).
- Un acuerdo o debate reflejado en un Judgment Day que no llegó a ser un ADR ratificado o no fue integrado al código debe tratarse como **propuesta histórica no vinculante**.

---

## 5. Cómo localizar auditorías y evidencias

Para auditorías del repositorio:
1. **Auditoría Integral 360° (2026-09-03):** Consultá [`muebles-audit-360-20260903/audit/README.md`](muebles-audit-360-20260903/audit/README.md). Si necesitás revisar un hallazgo específico, consultá el archivo JSON correspondiente en `muebles-audit-360-20260903/audit/data/` o abrí `index.html` en un navegador.
2. **Auditoría de Backend y Base de Datos (Issue #670):** Consultá [`docs/architecture/audit-670-final.md`](../architecture/audit-670-final.md) para el reporte de seguridad, RLS y contratos de base de datos.
3. **Auditorías de metodología Agent-First (Issue #1286):** Consultá [`docs/agent-first-methodology.md`](../agent-first-methodology.md) y los PRs asociados (#1288, #1292).

---

## 6. Cómo recuperar el historial de una implementación

La trazabilidad de una implementación depende de la era en la que se construyó:
- **Era G-ODD (septiembre 2026 en adelante):**
  Cada tarea sustancial autorizada cuenta con un artefacto inmutable en [`odd/tasks/<issue>-<slug>.md`](../../odd/tasks/README.md). Buscá el archivo por el número de issue correspondiente.
- **Era Pre-ODD (abril a septiembre 2026):**
  Consultá la bitácora cronológica [`progress/history.md`](../../progress/history.md) para ubicar la sesión o feature, y los archivos correspondientes en [`progress/archive/`](../../progress/archive/) (`impl_*`, `review_*`, `close_*`).

---

## 7. Trazabilidad de issues, PRs y commits

Todos los registros históricos deben mantener sus enlaces externos o referencias textuales estables:
- **Issues y PRs:** Referenciados como `#<id>` o URLs completas de GitHub.
- **Commits:** Referenciados por sus identificadores SHA (cortos de 8 caracteres o completos de 40). Los commits son inmutables; si un informe audita un commit determinado (ej. `316df57c`), sus afirmaciones aplican a ese snapshot y no pueden extrapolarse al estado actual de `main` sin re-verificación.

---

## 8. Cómo identificar documentos supersedidos

Un documento se considera **supersedido** cuando existe una especificación posterior que asume formalmente la autoridad sobre ese dominio.
- En la cabecera de los documentos supersedidos se incluye un banner de advertencia señalando el documento sucesor.
- Ejemplo canónico: [`docs/history/prd.md`](prd.md) indica explícitamente que su sucesor vigente es [`docs/prd-v2.md`](../prd-v2.md).
- Si encontrás un documento que parece describir un comportamiento obsoleto pero carece de banner, **no asumas que está vigente**: verificá el código fuente y los tests antes de actuar.

---

## 9. Jerarquía de autoridad ante contradicciones

Si un documento histórico contradice un documento de otra sección o el código fuente, la contradicción se resuelve aplicando esta jerarquía estricta (de mayor a menor autoridad):

1. **Implementación real y tests automatizados aprobados en `main`:** Lo que el software efectivamente hace y valida.
2. **Contratos generados y formales:** OpenAPI YAML (`contracts/openapi/`), DTOs generados y esquemas de base de datos.
3. **Documentos canónicos de arquitectura:** [`docs/architecture.md`](../architecture.md) y los documentos especializados bajo [`docs/architecture/`](../architecture/).
4. **ADRs Aceptados:** Registros en [`docs/adr/`](../adr/README.md) con estado `Accepted`.
5. **Documentación operativa viva:** [`docs/prd-v2.md`](../prd-v2.md), [`docs/design.md`](../design.md), [`docs/conventions.md`](../conventions.md), [`docs/verification.md`](../verification.md).
6. **ADRs Propuestos:** Documentos en [`docs/adr/`](../adr/README.md) con estado `Proposed` (no autorizan implementación hasta ser aceptados).
7. **Documentos históricos y snapshots:** Archivos bajo `docs/history/**`, `progress/**` y reportes fechados en `docs/demo/`. **Un documento histórico nunca anula una fuente de mayor jerarquía.**

---

## 10. Cómo añadir un nuevo registro histórico

Para incorporar una nueva investigación, reporte de incidente post-mortem o snapshot de auditoría:

1. Usá la plantilla canónica [`docs/history/TEMPLATE.md`](TEMPLATE.md).
2. Asigná un nombre de archivo descriptivo y fechado si corresponde (ej. `auditoria-dominio-YYYYMMDD.md`).
3. Completá los metadatos YAML iniciales con honestidad; si un dato no está verificado, usá `unverified`.
4. Incluí la sección obligatoria de **Alcance temporal y commit auditado**.
5. Añadí la entrada correspondiente en este índice ([`docs/history/README.md`](README.md)).
6. **No utilices esta carpeta** para guardar planes de tareas en curso de un agente (usá [`odd/tasks/`](../../odd/tasks/README.md)).

---

## 11. Prevención de duplicaciones

- **Enlazar, no copiar:** Si un nuevo documento necesita citar un análisis histórico, colocá un enlace al archivo canónico en `docs/history/`. No dupliques secciones completas en `docs/` o `AGENTS.md`.
- **Una sola fuente de verdad:** La verdad operativa reside en los documentos canónicos de dominio; este directorio solo conserva la memoria de cómo se llegó a ella.

---

## 12. Distinción entre hechos verificados e hipótesis

Al documentar o interpretar registros históricos:
- **Hecho verificado:** Aquel respaldado por una prueba reproducible, una salida de consola real, un commit SHA concreto o una captura de datos verificada.
- **Hipótesis o sospecha:** Cualquier conclusión basada en inferencia, patrones incompletos o extrapolaciones. Debe marcarse obligatoriamente como `UNKNOWN`, `NO VERIFICADO` o `HIPÓTESIS PENDIENTE DE VALIDACIÓN`.
- La ausencia de evidencia de un fallo **no demuestra** que el sistema funcione correctamente; solo demuestra que no fue probado en ese escenario.
