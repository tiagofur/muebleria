# Cierre de auditoría: trabajo realizado y brechas reales

**El reporte tiene análisis acotado para los 52 requisitos originales; eso no acredita auditoría exhaustiva ni preparación integral del producto.** La decisión de cierre pertenece al auditor principal y debe considerar las brechas siguientes, no la mera existencia de JSON o columnas.

## Qué ya no corresponde llamar «solamente inventariado»

- Documentación: 371 archivos con lectura derivada de contenido, claims seleccionados y contraste por 15 familias. Clasificación: 36 DOC-ONLY, 13 STALE, 306 INCOMPLETE y 16 CORRECT. No se certifica cada frase ni se reejecutan resultados históricos. Fuente: `data/docs-semantic-audit.json`.
- Funcionalidades: 204 filas, 200 PARTIAL, 4 UNKNOWN; las capas distinguen fragmentos semánticos revisados, referencias candidatas, N/A y falta de prueba. Cero COMPLETE. Conteo leído del JSON actual; no utilizar snapshots previos. Fuente: `data/feature-matrix.json`.
- API: inventario mixto de241registrosruntime y24declaracionesOpenAPI y revisión profunda de 21 endpoints críticos. Suplemento ahora 244filas, combinado263semánticas; no confundirlo con ejecuciónHTTP. Fuente: `data/endpoint-deep-audit.json`.
- Flujo comercial: recorrido guest sintético cliente→cotización→placement→undo/redo→quoted→accepted→plant board y estado comercial producción. No prueba API, ejecución física ni instalación. QV-01 explica el historial omitido: síntoma guest más composición de código, no una pérdida demostrada de DesignRevision. Fuentes: `data/guest-journey.json`, `data/quote-version-audit.json`.
- Portal: deduplicación conserva inventario original dentro de cada registro semántico; datos completos permanecen disponibles. Syntax y rutas locales exactas verificadas por `scripts/check_portal.py`; interacción sigue bajo evidencia del auditor principal.

## Trabajo de auditoría aún realizable, no impedimento externo

| Brecha | Evidencia que falta para ampliarla | Condición de cierre honesta |
|---|---|---|
| Feature matrix exhaustiva | Validar criterios individuales y pruebas de todas las capas pendientes; la revisión semántica de fragmentos ya cubre las204filas | Mantener UNKNOWN por fila o completar lectura puntual; no confundir search excerpts con revisión completa |
| Backend completo | 263 registros con semántica acotada +2declaraciones futuras revisadas; quedan callers/DTOs/side effects/roles no probados, no filas ignoradas | Declarar muestreo crítico y brecha, o ampliar revisión; no «265 endpoints auditados profundamente» |
| Pantalla por pantalla en todos sus estados | Ejecutar validaciones, denegaciones, loading/error/success, responsive y roles de superficies todavía sólo estáticas | Diferenciar estados observados de tokens extraídos; guest no cubre permisos autenticados |
| Permisos efectivos | Matriz acción×recurso×tenant×relationship×step-up con denegación y ruta real, no sólo 536 predicados role-only | Hay41composiciones efectivas y244/244suplementarias vinculadas, además del ledger265mixto; sigue sin prueba HTTP exhaustiva |
| Datos finales PostgreSQL — metadata incorporada | 75 tablas public actuales (74 aplicación/control + schema_migrations),842columnas,435constraints,279índices;11revisiones semánticas. Metadata SELECT-only, sin filas de negocio | Ya reconciliado con76nombres históricos preservados; pendientes reales: huérfanos en datos, query plans/carga y configuración productiva |
| QA del portal actualizado | Reabrir bundle final; comprobar docs sin duplicados, nuevos hallazgos, enlaces, filtros y gráficos | El intento final quedó bloqueado por error interno del navegador tras servidor sin respuesta; servidor reiniciado responde HEAD200. Conservar QA interactivo anterior, declarar mapping final sólo estático; no atribuirlo al producto |
| Consistencia final | Counts, ocho Top10, mappings, normalizador y referencias locales regenerados; el auditor principal valida su respuesta final contra las15secciones solicitadas | Ninguna declaración de demo integral verde, cierre de issues o producto reparado |

## Verificaciones que requieren entorno, autorización o evidencia adicional

| Verificación | Falta exacta / límite | Lo que sí se sabe |
|---|---|---|
| Recorrido autoritativo completo | Cliente/cotización/design/release/producción/instalación conectados por IDs/revisión con API+PostgreSQL y roles reales | Foundation y17browser checks son pruebas reales pero de otro alcance; guest es local |
| SketchUp host | Modelo sintético aislado, build de extensión con SHA conocido, permiso para manipular host y TestUp undo/save-reopen | App activa con modelo del usuario no debe alterarse para fabricar prueba; revisión código y Ruby no son host |
| CNC/hardware homologado | SKU/documentación exacta y software/máquina/perfil/version; import-readback/evidence pack | Defectos DXF/fallback reproducidos; no prueba compatibilidad física |
| Restore/deploy/observabilidad | Staging autorizado, backups concretos, simulación restore/fallo y telemetría | Scripts/configs revisados y smoke estructural; no resiliencia operativa demostrada |
| Advisories de dependencias | Consulta advisory concluida; intento acotado `pnpm audit` excedió90s | Timeout no significa cero vulnerabilidades; lockfile sin cambios |
| Rendimiento representativo | Dataset/carga y medición FPS/SQL/latencias en entorno controlado | Bundle grande y patrones de costo son evidencia, no números de latencia/FPS |
| Apertura file:// del portal | Navegador que permita esquema file y lectura real del archivo; herramienta actual lo bloquea | Todo asset/script local, sin dependencia fetch/CDN; no evadir política para afirmar prueba |

## Interpretación de la DoD

`completion-coverage.json` distingue `reviewPerformed` y `auditDisposition` de `goalCompletion`. Esto reconoce trabajo efectivamente ejecutado sin convertir limitaciones en «nada se auditó». Tampoco autoriza cerrar por presencia. Los UNKNOWN permitidos por el pedido deben seguir acompañados de pregunta verificable, evidencia faltante y alcance; las brechas realizables anteriores no deben presentarse como bloqueos externos.

## Rolling evidence update

The earlier numeric snapshots above are superseded by this section and evidence/rolling-closeout-counts.json: features200 PARTIAL, 4 UNKNOWN; no candidate-only blanket is retained when semantic fragments exist. API241runtime+24declarations, combinedsemantic263, futuredeclarations2, unrevieweddisposition0.

Remaining real work concerns per-criterion acceptance, effective role/resource/relationship checks, per-screen unexecuted states and authoritative end-to-end continuity—not absence of all review. Native host, machine readback, representative load and final file:// runtime remain narrowly bounded UNKNOWN. New mainPR550 is outside this audit, not silently incorporated.
