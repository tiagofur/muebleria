# Cobertura de auditoría acotada — no certificación integral del producto

52 requisitos del checklist original mapeados. Ninguno se convierte automáticamente en completado por existir un archivo.

| ID | Requisito | Evidencia / nivel | Límite |
|---|---|---|---|
| DOD-01 | inventario de documentación | INVENTORIED; data/docs-governance.json#documents | 371 documentos indexados y vinculados a revisión semántica por familias; alcance exacto: árbol rastreado del SHA, no documentos externos. |
| DOD-02 | auditoría de documentación | FAMILY_SEMANTIC_REVIEW_PERFORMED; data/docs-semantic-audit.json#documents, data/docs-semantic-audit.json#families, data/docs-semantic-audit.json#findings, evidence/docs-semantic-audit.md | 371 archivos leídos para claims/metadatos y clasificados mediante 15 familias y contraste de afirmaciones seleccionadas. No es certificación de cada frase ni reejecución de toda evidencia histórica; ver readScope y rationale por documento. |
| DOD-03 | inventario de módulos | INVENTORIED; data/backend-audit.json#modules, data/synthesis.json#productMap | 151 archivos backend declarados por capa; no equivale a inventario semántico completo de todos los bounded contexts ni revisión de todos los servicios. |
| DOD-04 | inventario de funcionalidades | SOURCE_MATRIX_RUNTIME_UNKNOWN; data/feature-matrix.json#features, data/docs-governance.json#features, data/sketchup-audit.json#features | 204 entradas enriquecidas por fuente:200 PARTIAL/4 UNKNOWN más seis capacidades SketchUp. Cada fila tiene fragmento semántico o alcance de postergación revisado; esto no cumple automáticamente todos los criterios o pruebas de capas. Cero funcionalidades COMPLETE acreditadas. Ver fieldCoverage y auditDepth. |
| DOD-05 | inventario de pantallas | INVENTORIED; data/web-inventory.json#screens, data/web-inventory.json#secondaryInterfaces | 29 rutas primarias, 259 interfaces secundarias y patrones adicionales. Hallazgo mecánico de componente no demuestra cobertura de toda interacción condicional. |
| DOD-06 | auditoría pantalla por pantalla | STATIC_PLUS_LIMITED_RUNTIME; data/web-inventory.json, data/web-semantic-audit.json, data/runtime-ui.json, evidence/web-audit.md | 29 pantallas con fragmentos semánticos y26cuerpos de tests inspeccionados;259secundarios/140inline con profundidad por fila. Sin contexto semántico específico: secundarios0, inline0; contratos compartidos no certifican cada consumidor. Navegación guest y algunas vistas/estados ejercitados; no se ejecutaron todos los formularios, roles, estados, responsive y flujos backend por pantalla. |
| DOD-07 | inventario de endpoints | MIXED_INVENTORY_AND_BOUNDED_HANDLER_REVIEW; data/backend-audit.json#endpoints, data/endpoint-deep-audit.json#endpoints, data/endpoint-supplement.json#endpoints | 265 registros mixtos: 241 registros runtime (incluidos wildcards/health) + 24 declaraciones OpenAPI/aliases; no son endpoints runtime distintos. 21 filas profundas + 244 suplementarias; 263 revisiones semánticas acotadas + 2 declaraciones futuras revisadas como scope; 0 sin disposición revisada. Declaración futura no es handler implementado. No prueban cada caller, DTO, side effect ni matriz HTTP. |
| DOD-08 | auditoría backend | TARGETED_STATIC_AND_TESTS; data/backend-audit.json, data/endpoint-supplement.json, data/defect-proofs.json | Inventario de handlers/storage y defectos focalizados; proofs de fallo cliente/DXF no prueban cada endpoint Go ni cada transacción. |
| DOD-09 | auditoría frontend | STATIC_PLUS_LIMITED_RUNTIME; data/web-inventory.json, data/web-semantic-audit.json, data/runtime-ui.json, evidence/web-audit.md | 29 pantallas con fragmentos semánticos y26cuerpos de tests inspeccionados;259secundarios/140inline con profundidad por fila. Sin contexto semántico específico: secundarios0, inline0; contratos compartidos no certifican cada consumidor. Navegación guest y algunas vistas/estados ejercitados; no se ejecutaron todos los formularios, roles, estados, responsive y flujos backend por pantalla. |
| DOD-10 | auditoría SketchUp | STATIC_REVIEW_RUNTIME_UNKNOWN; data/sketchup-audit.json, evidence/native-host-verification.md | Arquitectura/contratos/edición/catálogo recorridos en código y suites Ruby. Host nativo TestUp, interacción undo/save-reopen, secure store y binding reales siguen sin ejecutar. |
| DOD-11 | auditoría integración Web/Backend/SketchUp | TARGETED_STATIC_AND_TESTS; data/backend-audit.json, data/endpoint-supplement.json, data/defect-proofs.json | Inventario de handlers/storage y defectos focalizados; proofs de fallo cliente/DXF no prueban cada endpoint Go ni cada transacción. |
| DOD-12 | auditoría modelo de dominio | TARGETED_STATIC_REVIEW; data/synthesis.json#graphs, data/synthesis.json#domainInvariants | Grafos y ownership contrastados para contextos críticos; no revisión semántica de cada entidad/regla del repositorio. |
| DOD-13 | auditoría base de datos | FINAL_SCHEMA_METADATA_AND_SEMANTIC_REVIEW; data/database-deep-audit.json, data/backend-audit.json#migrations, evidence/database-deep-audit.md, evidence/pilot-foundation-proof.log | Metadata SELECT-only del esquema final:75 tablas public (74 aplicación/control +schema_migrations),842 columnas,435 constraints,279 índices,71 RLS enable+force,27 triggers,migración116;11 revisiones semánticas. Inventario histórico76 incluye2tablas retiradas y no schema_migrations. Sin consultar filas negocio: huérfanos reales, planes SQL/cargas y producción siguen no verificados. |
| DOD-14 | auditoría multitenancy | SCOPED_RUNTIME_VERIFIED; evidence/pilot-foundation-proof.log, evidence/organization-browser.log, data/backend-audit.json | Foundation y cambio de tenant probados en alcance de sus tests. No acredita aislamiento de todos los uploads/jobs/exports/logs/SketchUp del producto. |
| DOD-15 | auditoría roles/permisos | STATIC_EFFECTIVE_COMPOSITION_RUNTIME_PARTIAL; data/backend-audit.json#permissions, data/effective-permissions.json, data/synthesis.json#permissionsReference | 536 filas role-only más41composiciones efectivas por familia recurso/acción, con credential/tenant/ownership/step-up y limitaciones. No son todas las permutaciones rol×estado ni denegaciones HTTP por cada celda. |
| DOD-16 | auditoría seguridad | TARGETED_REVIEW; data/backend-audit.json#findings, data/operations-audit.json, evidence/pilot-foundation-proof.log | Auth/RLS y upload revisados; no pentest integral, consulta de advisories de dependencias, entorno productivo, explotación IDOR/XSS/CSRF por cada ruta. |
| DOD-17 | auditoría tests | SCOPED_CHECKS_VERIFIED; data/operations-audit.json, evidence/main-checks.json, evidence/organization-browser.log, evidence/init-isolated-db.log | Resultados acotados del SHA y revisión CI/operación. No cobertura semántica exhaustiva, escáner externo de supply chain ni deploy/restore real. Cachés y skips del init no se convierten en pruebas ejecutadas. |
| DOD-18 | auditoría CI/CD | SCOPED_CHECKS_VERIFIED; data/operations-audit.json, evidence/main-checks.json, evidence/organization-browser.log, evidence/init-isolated-db.log | Resultados acotados del SHA y revisión CI/operación. No cobertura semántica exhaustiva, escáner externo de supply chain ni deploy/restore real. Cachés y skips del init no se convierten en pruebas ejecutadas. |
| DOD-19 | auditoría UX/UI | STATIC_PLUS_LIMITED_RUNTIME; data/web-inventory.json, data/web-semantic-audit.json, data/runtime-ui.json, evidence/web-audit.md | 29 pantallas con fragmentos semánticos y26cuerpos de tests inspeccionados;259secundarios/140inline con profundidad por fila. Sin contexto semántico específico: secundarios0, inline0; contratos compartidos no certifican cada consumidor. Navegación guest y algunas vistas/estados ejercitados; no se ejecutaron todos los formularios, roles, estados, responsive y flujos backend por pantalla. |
| DOD-20 | auditoría 3D | STATIC_PLUS_LIMITED_RUNTIME; data/runtime-ui.json, data/guest-journey.json, evidence/guest-proyectar-390-measurements.json, evidence/guest-proyectar-768-measurements.json | WebGL desktop/cámara, placement local y undo/redo ensayados; canvas cero en 390/768 observado. Falta drag/snap exhaustivo, carga compleja, profiling FPS y host real. |
| DOD-21 | auditoría herrajes | STATIC_PLUS_HAZARD_PROOFS; data/sketchup-audit.json, data/defect-proofs.json, evidence/guest-hardware-editor-dom.txt | Modelo/editor genérico y defectos DXF/fallback reproducidos. No homologación SKU Blum, operación interactiva host ni import-readback de software/máquina real. |
| DOD-22 | auditoría perforaciones | STATIC_PLUS_HAZARD_PROOFS; data/sketchup-audit.json, data/defect-proofs.json, evidence/guest-hardware-editor-dom.txt | Modelo/editor genérico y defectos DXF/fallback reproducidos. No homologación SKU Blum, operación interactiva host ni import-readback de software/máquina real. |
| DOD-23 | auditoría CNC/exportación | STATIC_PLUS_HAZARD_PROOFS; data/sketchup-audit.json, data/defect-proofs.json, evidence/guest-hardware-editor-dom.txt | Modelo/editor genérico y defectos DXF/fallback reproducidos. No homologación SKU Blum, operación interactiva host ni import-readback de software/máquina real. |
| DOD-24 | auditoría quotes | PARTIAL_VERTICAL_REVIEW; data/synthesis.json#journeys, data/guest-journey.json, data/quote-version-audit.json, data/operational-flows.json | Cadenas operativas revisadas y recorrido guest sintético cliente→cotización→placement→undo/redo→quoted→accepted→plant board ejecutado; defecto QV-01 de historial corroborado. Falta continuidad autoritativa API/PostgreSQL/host hasta release, producción e instalación; no contar estado comercial local como ejecución física. |
| DOD-25 | auditoría designs | PARTIAL_VERTICAL_REVIEW; data/synthesis.json#journeys, data/guest-journey.json, data/quote-version-audit.json, data/operational-flows.json | Cadenas operativas revisadas y recorrido guest sintético cliente→cotización→placement→undo/redo→quoted→accepted→plant board ejecutado; defecto QV-01 de historial corroborado. Falta continuidad autoritativa API/PostgreSQL/host hasta release, producción e instalación; no contar estado comercial local como ejecución física. |
| DOD-26 | auditoría furniture | PARTIAL_VERTICAL_REVIEW; data/synthesis.json#journeys, data/guest-journey.json, data/quote-version-audit.json, data/operational-flows.json | Cadenas operativas revisadas y recorrido guest sintético cliente→cotización→placement→undo/redo→quoted→accepted→plant board ejecutado; defecto QV-01 de historial corroborado. Falta continuidad autoritativa API/PostgreSQL/host hasta release, producción e instalación; no contar estado comercial local como ejecución física. |
| DOD-27 | auditoría production | PARTIAL_VERTICAL_REVIEW; data/synthesis.json#journeys, data/guest-journey.json, data/quote-version-audit.json, data/operational-flows.json | Cadenas operativas revisadas y recorrido guest sintético cliente→cotización→placement→undo/redo→quoted→accepted→plant board ejecutado; defecto QV-01 de historial corroborado. Falta continuidad autoritativa API/PostgreSQL/host hasta release, producción e instalación; no contar estado comercial local como ejecución física. |
| DOD-28 | auditoría installation | PARTIAL_VERTICAL_REVIEW; data/synthesis.json#journeys, data/guest-journey.json, data/quote-version-audit.json, data/operational-flows.json | Cadenas operativas revisadas y recorrido guest sintético cliente→cotización→placement→undo/redo→quoted→accepted→plant board ejecutado; defecto QV-01 de historial corroborado. Falta continuidad autoritativa API/PostgreSQL/host hasta release, producción e instalación; no contar estado comercial local como ejecución física. |
| DOD-29 | revisión de issues relevantes | TARGETED_REVIEW_AND_METADATA; data/docs-governance.json#issues, data/docs-governance.json#prs, data/docs-governance.json#githubScope | 154 issues/100 PRs inventariados; metadatos y trackers críticos contrastados. No revisión completa de comentarios/diff de todos los issues/PRs; snapshot de metadata puede ser posterior al main auditado. |
| DOD-30 | revisión de PRs relevantes | TARGETED_REVIEW_AND_METADATA; data/docs-governance.json#issues, data/docs-governance.json#prs, data/docs-governance.json#githubScope | 154 issues/100 PRs inventariados; metadatos y trackers críticos contrastados. No revisión completa de comentarios/diff de todos los issues/PRs; snapshot de metadata puede ser posterior al main auditado. |
| DOD-31 | contract drift analizado | STATIC_REVIEW_RUNTIME_UNKNOWN; data/synthesis.json#integrationMatrix, data/synthesis.json#journeys, data/sketchup-audit.json, evidence/openapi-check.log | Matriz y cadenas A–E documentan rupturas. Check generado prueba drift de generación, no toda paridad legacy. Falta recorrido bidireccional Web/Go/SketchUp del mismo ID y revisión. |
| DOD-32 | documentación vs implementación contrastada | FAMILY_SEMANTIC_REVIEW_PERFORMED; data/docs-semantic-audit.json#documents, data/docs-semantic-audit.json#families, data/docs-semantic-audit.json#findings, evidence/docs-semantic-audit.md | 371 archivos leídos para claims/metadatos y clasificados mediante 15 familias y contraste de afirmaciones seleccionadas. No es certificación de cada frase ni reejecución de toda evidencia histórica; ver readScope y rationale por documento. |
| DOD-33 | feature matrix completa | SOURCE_MATRIX_RUNTIME_UNKNOWN; data/feature-matrix.json#features, data/docs-governance.json#features, data/sketchup-audit.json#features | 204 entradas enriquecidas por fuente:200 PARTIAL/4 UNKNOWN más seis capacidades SketchUp. Cada fila tiene fragmento semántico o alcance de postergación revisado; esto no cumple automáticamente todos los criterios o pruebas de capas. Cero funcionalidades COMPLETE acreditadas. Ver fieldCoverage y auditDepth. |
| DOD-34 | integration matrix completa | STATIC_REVIEW_RUNTIME_UNKNOWN; data/synthesis.json#integrationMatrix, data/synthesis.json#journeys, data/sketchup-audit.json, evidence/openapi-check.log | Matriz y cadenas A–E documentan rupturas. Check generado prueba drift de generación, no toda paridad legacy. Falta recorrido bidireccional Web/Go/SketchUp del mismo ID y revisión. |
| DOD-35 | permission matrix completa | STATIC_EFFECTIVE_COMPOSITION_RUNTIME_PARTIAL; data/backend-audit.json#permissions, data/effective-permissions.json, data/synthesis.json#permissionsReference | 536 filas role-only más41composiciones efectivas por familia recurso/acción, con credential/tenant/ownership/step-up y limitaciones. No son todas las permutaciones rol×estado ni denegaciones HTTP por cada celda. |
| DOD-36 | risk register | ARTIFACT_PRODUCED_NOT_EXECUTED; data/synthesis.json#risks, evidence/synthesis.md | Contenido estructurado basado en evidencia e inferencia/propuesta explícitas. Recomendaciones, guion y bandas ordinales no acreditan implementación ni ensayo integral; consultar unknowns y gates. |
| DOD-37 | technical debt register | ARTIFACT_PRODUCED_NOT_EXECUTED; data/synthesis.json#technicalDebt, evidence/synthesis.md | Contenido estructurado basado en evidencia e inferencia/propuesta explícitas. Recomendaciones, guion y bandas ordinales no acreditan implementación ni ensayo integral; consultar unknowns y gates. |
| DOD-38 | MVP gap analysis | ARTIFACT_PRODUCED_NOT_EXECUTED; data/synthesis.json#mvpGaps, evidence/synthesis.md | Contenido estructurado basado en evidencia e inferencia/propuesta explícitas. Recomendaciones, guion y bandas ordinales no acreditan implementación ni ensayo integral; consultar unknowns y gates. |
| DOD-39 | demo gap analysis | ARTIFACT_PRODUCED_NOT_EXECUTED; data/synthesis.json#mvpGaps, evidence/synthesis.md | Contenido estructurado basado en evidencia e inferencia/propuesta explícitas. Recomendaciones, guion y bandas ordinales no acreditan implementación ni ensayo integral; consultar unknowns y gates. |
| DOD-40 | demo blockers identificados | ARTIFACT_PRODUCED_NOT_EXECUTED; data/synthesis.json#tasks, evidence/synthesis.md | Contenido estructurado basado en evidencia e inferencia/propuesta explícitas. Recomendaciones, guion y bandas ordinales no acreditan implementación ni ensayo integral; consultar unknowns y gates. |
| DOD-41 | fastest safe path to demo | ARTIFACT_PRODUCED_NOT_EXECUTED; data/synthesis.json#fastestSafePath, evidence/synthesis.md | Contenido estructurado basado en evidencia e inferencia/propuesta explícitas. Recomendaciones, guion y bandas ordinales no acreditan implementación ni ensayo integral; consultar unknowns y gates. |
| DOD-42 | roadmap | ARTIFACT_PRODUCED_NOT_EXECUTED; data/synthesis.json#roadmap, evidence/synthesis.md | Contenido estructurado basado en evidencia e inferencia/propuesta explícitas. Recomendaciones, guion y bandas ordinales no acreditan implementación ni ensayo integral; consultar unknowns y gates. |
| DOD-43 | issue plan | ARTIFACT_PRODUCED_NOT_EXECUTED; data/synthesis.json#issuePlan, evidence/synthesis.md | Contenido estructurado basado en evidencia e inferencia/propuesta explícitas. Recomendaciones, guion y bandas ordinales no acreditan implementación ni ensayo integral; consultar unknowns y gates. |
| DOD-44 | user manual | ARTIFACT_PRODUCED_NOT_EXECUTED; data/synthesis.json#userManual, evidence/synthesis.md | Contenido estructurado basado en evidencia e inferencia/propuesta explícitas. Recomendaciones, guion y bandas ordinales no acreditan implementación ni ensayo integral; consultar unknowns y gates. |
| DOD-45 | demo playbook | ARTIFACT_PRODUCED_NOT_EXECUTED; data/synthesis.json#demoPlaybook, evidence/synthesis.md | Contenido estructurado basado en evidencia e inferencia/propuesta explícitas. Recomendaciones, guion y bandas ordinales no acreditan implementación ni ensayo integral; consultar unknowns y gates. |
| DOD-46 | scorecard | ARTIFACT_PRODUCED_NOT_EXECUTED; data/synthesis.json#scorecard, evidence/synthesis.md | Contenido estructurado basado en evidencia e inferencia/propuesta explícitas. Recomendaciones, guion y bandas ordinales no acreditan implementación ni ensayo integral; consultar unknowns y gates. |
| DOD-47 | reporte HTML completo | ARTIFACT_IMPLEMENTED_SCOPED_QA; index.html, js/app.js, css/main.css, css/print.css, evidence/portal-static-qa.md, assets/portal-mobile.png | Portal implementado; root verificó HTTP localhost desktop/móvil y búsqueda antes del último mapping. Último mapping sólo syntax/rutas estáticas: reintento browser bloqueado por error interno tras servidor reiniciado, no defecto demostrado del portal. Apertura file:// bloqueada por política del navegador de herramientas: runtime file:// UNKNOWN. No confundir portal completo con auditoría completa. |
| DOD-48 | CSS completo | ARTIFACT_IMPLEMENTED_SCOPED_QA; index.html, js/app.js, css/main.css, css/print.css, evidence/portal-static-qa.md, assets/portal-mobile.png | Portal implementado; root verificó HTTP localhost desktop/móvil y búsqueda antes del último mapping. Último mapping sólo syntax/rutas estáticas: reintento browser bloqueado por error interno tras servidor reiniciado, no defecto demostrado del portal. Apertura file:// bloqueada por política del navegador de herramientas: runtime file:// UNKNOWN. No confundir portal completo con auditoría completa. |
| DOD-49 | JavaScript funcional | ARTIFACT_IMPLEMENTED_SCOPED_QA; index.html, js/app.js, css/main.css, css/print.css, evidence/portal-static-qa.md, assets/portal-mobile.png | Portal implementado; root verificó HTTP localhost desktop/móvil y búsqueda antes del último mapping. Último mapping sólo syntax/rutas estáticas: reintento browser bloqueado por error interno tras servidor reiniciado, no defecto demostrado del portal. Apertura file:// bloqueada por política del navegador de herramientas: runtime file:// UNKNOWN. No confundir portal completo con auditoría completa. |
| DOD-50 | navegación y búsqueda funcionando | ARTIFACT_IMPLEMENTED_SCOPED_QA; index.html, js/app.js, css/main.css, css/print.css, evidence/portal-static-qa.md, assets/portal-mobile.png | Portal implementado; root verificó HTTP localhost desktop/móvil y búsqueda antes del último mapping. Último mapping sólo syntax/rutas estáticas: reintento browser bloqueado por error interno tras servidor reiniciado, no defecto demostrado del portal. Apertura file:// bloqueada por política del navegador de herramientas: runtime file:// UNKNOWN. No confundir portal completo con auditoría completa. |
| DOD-51 | executive summary | ARTIFACT_PRODUCED_NOT_EXECUTED; data/synthesis.json#executive, evidence/synthesis.md | Contenido estructurado basado en evidencia e inferencia/propuesta explícitas. Recomendaciones, guion y bandas ordinales no acreditan implementación ni ensayo integral; consultar unknowns y gates. |
| DOD-52 | lista final de prioridades | ARTIFACT_PRODUCED_NOT_EXECUTED; data/synthesis.json#tasks, evidence/synthesis.md | Contenido estructurado basado en evidencia e inferencia/propuesta explícitas. Recomendaciones, guion y bandas ordinales no acreditan implementación ni ensayo integral; consultar unknowns y gates. |

## Campos requeridos: faltantes reales

Conteo estructural únicamente. Campos presentes con UNKNOWN o señales extraídas no están verificados.

| Inventario | Campo | Filas | Presente | Ausente | Vacío | UNKNOWN explícito |
|---|---|---:|---:|---:|---:|---:|
| features | ID | 204 | 204 | 0 | 0 | 0 |
| features | Module | 204 | 204 | 0 | 0 | 0 |
| features | Feature | 204 | 204 | 0 | 0 | 0 |
| features | Description | 204 | 204 | 0 | 0 | 1 |
| features | Users | 204 | 204 | 0 | 0 | 0 |
| features | Status | 204 | 204 | 0 | 0 | 4 |
| features | Frontend | 204 | 204 | 0 | 0 | 204 |
| features | Backend | 204 | 204 | 0 | 0 | 204 |
| features | SketchUp | 204 | 204 | 0 | 0 | 204 |
| features | Tests | 204 | 204 | 0 | 0 | 204 |
| features | Documentation | 204 | 204 | 0 | 0 | 59 |
| features | Demo importance | 204 | 204 | 0 | 0 | 0 |
| features | MVP importance | 204 | 204 | 0 | 0 | 0 |
| features | Problems | 204 | 204 | 0 | 0 | 182 |
| features | Recommendation | 204 | 204 | 0 | 0 | 0 |
| features | Related issues | 204 | 204 | 0 | 101 | 0 |
| features | Related PRs | 204 | 204 | 0 | 0 | 152 |
| endpoints | METHOD | 265 | 265 | 0 | 0 | 0 |
| endpoints | PATH | 265 | 265 | 0 | 0 | 0 |
| endpoints | PURPOSE | 265 | 0 | 265 | 0 | 0 |
| endpoints | AUTH | 265 | 241 | 24 | 0 | 0 |
| endpoints | ROLES | 265 | 0 | 265 | 0 | 0 |
| endpoints | TENANT | 265 | 0 | 265 | 0 | 0 |
| endpoints | INPUT | 265 | 0 | 265 | 0 | 0 |
| endpoints | VALIDATION | 265 | 0 | 265 | 0 | 0 |
| endpoints | OUTPUT | 265 | 0 | 265 | 0 | 0 |
| endpoints | ERRORS | 265 | 0 | 265 | 0 | 0 |
| endpoints | DOMAIN OBJECTS | 265 | 0 | 265 | 0 | 0 |
| endpoints | CALLERS | 265 | 0 | 265 | 0 | 0 |
| endpoints | DEPENDENCIES | 265 | 0 | 265 | 0 | 0 |
| endpoints | SIDE EFFECTS | 265 | 0 | 265 | 0 | 0 |
| endpoints | RELATED WEB SCREEN | 265 | 0 | 265 | 0 | 0 |
| endpoints | RELATED SKETCHUP FUNCTION | 265 | 0 | 265 | 0 | 0 |
| endpoints | TEST COVERAGE | 265 | 0 | 265 | 0 | 0 |
| endpoints | KNOWN PROBLEMS | 265 | 0 | 265 | 0 | 0 |
| screens | Nombre | 29 | 29 | 0 | 0 | 0 |
| screens | Ruta | 29 | 29 | 0 | 0 | 0 |
| screens | Objetivo | 29 | 29 | 0 | 0 | 0 |
| screens | Usuario objetivo | 29 | 29 | 0 | 0 | 0 |
| screens | Roles permitidos | 29 | 29 | 0 | 0 | 0 |
| screens | Datos utilizados | 29 | 29 | 0 | 0 | 0 |
| screens | APIs utilizadas | 29 | 29 | 0 | 23 | 0 |
| screens | Estados | 29 | 29 | 0 | 0 | 29 |
| screens | Acciones principales | 29 | 29 | 0 | 8 | 0 |
| screens | Acciones secundarias | 29 | 29 | 0 | 0 | 0 |
| screens | Navegación de entrada | 29 | 29 | 0 | 0 | 0 |
| screens | Navegación de salida | 29 | 29 | 0 | 3 | 0 |
| screens | Componentes relevantes | 29 | 29 | 0 | 0 | 28 |
| screens | Loading state | 29 | 29 | 0 | 0 | 29 |
| screens | Empty state | 29 | 29 | 0 | 0 | 29 |
| screens | Error state | 29 | 29 | 0 | 0 | 29 |
| screens | Success state | 29 | 29 | 0 | 0 | 29 |
| screens | Validaciones | 29 | 29 | 0 | 15 | 0 |
| screens | Responsive behavior | 29 | 29 | 0 | 0 | 29 |
| screens | Permisos | 29 | 29 | 0 | 1 | 0 |
| screens | Problemas | 29 | 29 | 0 | 20 | 0 |
| screens | Deuda | 29 | 29 | 0 | 0 | 0 |
| screens | Mejoras | 29 | 29 | 0 | 0 | 0 |
| screens | Prioridad | 29 | 29 | 0 | 0 | 0 |
| screens | Importancia para demo | 29 | 29 | 0 | 0 | 0 |
| endpoints-deep | METHOD | 21 | 21 | 0 | 0 | 0 |
| endpoints-deep | PATH | 21 | 21 | 0 | 0 | 0 |
| endpoints-deep | PURPOSE | 21 | 21 | 0 | 0 | 0 |
| endpoints-deep | AUTH | 21 | 21 | 0 | 0 | 0 |
| endpoints-deep | ROLES | 21 | 21 | 0 | 0 | 0 |
| endpoints-deep | TENANT | 21 | 21 | 0 | 0 | 0 |
| endpoints-deep | INPUT | 21 | 21 | 0 | 0 | 0 |
| endpoints-deep | VALIDATION | 21 | 21 | 0 | 0 | 0 |
| endpoints-deep | OUTPUT | 21 | 21 | 0 | 0 | 0 |
| endpoints-deep | ERRORS | 21 | 21 | 0 | 0 | 0 |
| endpoints-deep | DOMAIN OBJECTS | 21 | 21 | 0 | 2 | 0 |
| endpoints-deep | CALLERS | 21 | 21 | 0 | 0 | 0 |
| endpoints-deep | DEPENDENCIES | 21 | 21 | 0 | 0 | 0 |
| endpoints-deep | SIDE EFFECTS | 21 | 21 | 0 | 0 | 0 |
| endpoints-deep | RELATED WEB SCREEN | 21 | 21 | 0 | 0 | 0 |
| endpoints-deep | RELATED SKETCHUP FUNCTION | 21 | 21 | 0 | 0 | 0 |
| endpoints-deep | TEST COVERAGE | 21 | 21 | 0 | 0 | 0 |
| endpoints-deep | KNOWN PROBLEMS | 21 | 21 | 0 | 0 | 1 |
| endpoints-supplement | METHOD | 244 | 244 | 0 | 0 | 0 |
| endpoints-supplement | PATH | 244 | 244 | 0 | 0 | 0 |
| endpoints-supplement | PURPOSE | 244 | 244 | 0 | 0 | 0 |
| endpoints-supplement | AUTH | 244 | 244 | 0 | 0 | 0 |
| endpoints-supplement | ROLES | 244 | 244 | 0 | 0 | 0 |
| endpoints-supplement | TENANT | 244 | 244 | 0 | 0 | 0 |
| endpoints-supplement | INPUT | 244 | 244 | 0 | 0 | 2 |
| endpoints-supplement | VALIDATION | 244 | 244 | 0 | 0 | 2 |
| endpoints-supplement | OUTPUT | 244 | 244 | 0 | 0 | 0 |
| endpoints-supplement | ERRORS | 244 | 244 | 0 | 0 | 0 |
| endpoints-supplement | DOMAIN OBJECTS | 244 | 244 | 0 | 0 | 0 |
| endpoints-supplement | CALLERS | 244 | 244 | 0 | 0 | 87 |
| endpoints-supplement | DEPENDENCIES | 244 | 244 | 0 | 43 | 0 |
| endpoints-supplement | SIDE EFFECTS | 244 | 244 | 0 | 0 | 0 |
| endpoints-supplement | RELATED WEB SCREEN | 244 | 0 | 244 | 0 | 0 |
| endpoints-supplement | RELATED SKETCHUP FUNCTION | 244 | 0 | 244 | 0 | 0 |
| endpoints-supplement | TEST COVERAGE | 244 | 244 | 0 | 0 | 181 |
| endpoints-supplement | KNOWN PROBLEMS | 244 | 244 | 0 | 0 | 0 |
