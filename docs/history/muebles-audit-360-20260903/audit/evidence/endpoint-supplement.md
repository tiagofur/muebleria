# Suplemento API: contratos declarados y semántica inspeccionada

242 filas adicionales inspeccionadas semánticamente; 244 enriquecidos con contrato cuando existe coincidencia exacta. Total combinado 263/265 con inspección semántica acotada. 2 son contratos futuros explícitos sin handler. 0 filas sin disposición estática. Ninguna llamada a producto, DB o prueba ejecutada en esta subauditoría.

## Denominador
265 filas mixtas:241 registros runtime +24 declaraciones OpenAPI adicionales. Muchas son alias del mismo wildcard; no son265 endpoints independientes.

## Límite de evidencia
Schema-confirmed significa declaración OpenAPI, no validación runtime. Handler-semantic significa lectura de ramas y helpers citados, no éxito HTTP ni auditoría exhaustiva de storage. Callers por prefijo y tests localizados son pistas verificables, no ejecución. Wildcards no se expandieron en operaciones sintéticas.

## Semántica adicional
| Registro | Propósito | Evidencia |
|---|---|---|
| GET /api/health | Liveness HTTP | backend-go/internal/api/routes.go:104-109 |
| POST /api/auth/refresh | Renovar credencial móvil por body | backend-go/internal/api/refresh_handlers.go:115-139; backend-go/internal/api/refresh_handlers.go:31-107; backend-go/internal/api/routes.go:122-232; backend-go/internal/api/refresh_handlers.go:154-171; backend-go/internal/api/handlers.go:890-994 |
| POST /api/auth/logout | Cerrar familia/sesión según transporte presentado | backend-go/internal/api/refresh_handlers.go:173-215; backend-go/internal/api/refresh_handlers.go:222-227; backend-go/internal/api/routes.go:122-232 |
| POST /api/auth/devices/enroll | Iniciar enrolamiento SketchUp | backend-go/internal/api/devices.go:26-90 |
| POST /api/auth/devices/enroll/poll | Consultar estado enrolamiento | backend-go/internal/api/devices.go:101-133 |
| POST /api/auth/devices/approve | Vincular código a usuario autenticado | backend-go/internal/api/devices.go:181-226; backend-go/internal/api/routes.go:145 |
| POST /api/auth/devices/exchange | Intercambiar enrollment aprobado por secret | backend-go/internal/api/devices.go:143-174 |
| POST /api/auth/devices/token | Emitir bearer SketchUp desde secreto de dispositivo | backend-go/internal/api/devices.go:250-326 |
| GET /api/auth/devices | Directorio y baja de dispositivos propios | backend-go/internal/api/devices.go:331-379; backend-go/internal/api/routes.go:148-149 |
| POST /api/auth/devices/revoke | Directorio y baja de dispositivos propios | backend-go/internal/api/devices.go:331-379; backend-go/internal/api/routes.go:148-149 |
| GET /api/auth/mfa/factors | Listar factores propios sin secretos | backend-go/internal/api/mfa.go:224-245; backend-go/internal/api/routes.go:122-232 |
| POST /api/auth/mfa/totp:begin | Iniciar factor TOTP pendiente | backend-go/internal/api/mfa.go:248-309; backend-go/internal/api/mfa.go:189-221; backend-go/internal/api/routes.go:122-232 |
| POST /api/auth/mfa/totp/{factorCommand...} | Verificar y habilitar factor pendiente | backend-go/internal/api/mfa.go:318-366; backend-go/internal/api/mfa.go:189-221; backend-go/internal/api/routes.go:122-232 |
| POST /api/auth/mfa/factors/{factorCommand...} | Revocar factor propio | backend-go/internal/api/mfa.go:370-392; backend-go/internal/api/routes.go:122-232 |
| POST /api/auth/mfa/recovery-codes:regenerate | Rotar recovery codes | backend-go/internal/api/mfa.go:396-426; backend-go/internal/api/routes.go:122-232 |
| POST /api/auth/mfa/step-up | Verificar segundo factor para scope exacto | backend-go/internal/api/mfa.go:429-497; backend-go/internal/api/routes.go:122-232 |
| GET /api/auth/me | Read model autoritativo de identidad y scope actual | backend-go/internal/api/handlers.go:2551-2622; backend-go/internal/api/routes.go:122-232 |
| GET /api/auth/sessions | Directorio y revocación de sesiones propias | backend-go/internal/api/session_directory.go:62-83; backend-go/internal/api/routes.go:169-170 |
| POST /api/auth/sessions/{sessionId}/revoke | Directorio y revocación de sesiones propias | backend-go/internal/api/session_directory.go:62-83; backend-go/internal/api/routes.go:169-170 |
| GET /api/platform/organizations | Lectura administrativa de organizaciones/cuentas/auditoría | backend-go/internal/api/platform.go:27-38; backend-go/internal/api/platform.go:87-101; backend-go/internal/api/platform.go:202-238 |
| PATCH /api/platform/organizations/{id} | Actualizar nombre/licencia organización | backend-go/internal/api/platform.go:104-199; backend-go/internal/api/routes.go:180 |
| GET /api/platform/organizations/{id}/audit | Lectura administrativa de organizaciones/cuentas/auditoría | backend-go/internal/api/platform.go:27-38; backend-go/internal/api/platform.go:87-101; backend-go/internal/api/platform.go:202-238 |
| GET /api/platform/users | Lectura administrativa de organizaciones/cuentas/auditoría | backend-go/internal/api/platform.go:27-38; backend-go/internal/api/platform.go:87-101; backend-go/internal/api/platform.go:202-238 |
| GET /api/platform/users/{userId}/sessions | Sesiones globales de una cuenta | backend-go/internal/api/session_directory.go:169-213; backend-go/internal/api/routes.go:183-184 |
| POST /api/platform/users/{userId}/sessions/{sessionId}/revoke | Sesiones globales de una cuenta | backend-go/internal/api/session_directory.go:169-213; backend-go/internal/api/routes.go:183-184 |
| POST /api/platform/users/{userCommand...} | Despachar cambio de account status global | backend-go/internal/api/platform.go:263-271; backend-go/internal/api/platform.go:237-261; backend-go/internal/api/routes.go:122-232 |
| POST /api/platform/organizations/{id}/support-session | Abrir soporte auditado scoped a organización | backend-go/internal/api/platform.go:276-334; backend-go/internal/api/routes.go:122-232 |
| DELETE /api/platform/support-sessions/{sessionId} | Finalizar soporte explícitamente | backend-go/internal/api/platform.go:337-354; backend-go/internal/api/routes.go:122-232 |
| GET /api/factory/organizations | Listar organizaciones hijas conectadas legacy | backend-go/internal/api/factory.go:87-106; backend-go/internal/api/factory.go:30-40; backend-go/internal/api/routes.go:122-232 |
| POST /api/organizations | Provisionar organización completa | backend-go/internal/api/organization_lifecycle.go:23-124; backend-go/internal/api/routes.go:122-232 |
| GET /api/organizations/{id}/readiness | Consultar readiness versionado | backend-go/internal/api/organization_lifecycle.go:197-216; backend-go/internal/api/routes.go:122-232 |
| GET /api/organizations/{id}/offboarding-preview | Previsualizar impacto de baja organización | backend-go/internal/api/organization_lifecycle.go:285-313; backend-go/internal/api/routes.go:122-232 |
| GET /api/organizations/{id}/entitlements | Consultar/actualizar entitlements | backend-go/internal/api/organization_lifecycle.go:315-359; backend-go/internal/api/routes.go:122-232 |
| PUT /api/organizations/{id}/entitlements | Consultar/actualizar entitlements | backend-go/internal/api/organization_lifecycle.go:315-359; backend-go/internal/api/routes.go:122-232 |
| POST /api/organizations/{organizationCommand...} | Ejecutar suspend/reactivate/begin-offboarding/terminate | backend-go/internal/api/organization_lifecycle.go:218-283; backend-go/internal/api/routes.go:122-232 |
| GET /api/org/memberships | Leer equipo por membresía, no cuentas globales | backend-go/internal/api/orgteam.go:35-54; backend-go/internal/api/orgteam.go:150-247 |
| GET /api/org/memberships/{membershipId} | Leer equipo por membresía, no cuentas globales | backend-go/internal/api/orgteam.go:35-54; backend-go/internal/api/orgteam.go:150-247 |
| GET /api/org/team/summary | Leer equipo por membresía, no cuentas globales | backend-go/internal/api/orgteam.go:35-54; backend-go/internal/api/orgteam.go:150-247 |
| GET /api/org/memberships/{membershipId}/sessions | Sesiones de una membresía del taller | backend-go/internal/api/session_directory.go:86-178; backend-go/internal/api/routes.go:212-213 |
| POST /api/org/memberships/{membershipId}/sessions/{sessionId}/revoke | Sesiones de una membresía del taller | backend-go/internal/api/session_directory.go:86-178; backend-go/internal/api/routes.go:212-213 |
| PUT /api/org/memberships/{membershipId}/roles | Modificar roles de membresía vía ruta legacy | backend-go/internal/api/orgteam.go:249-306; backend-go/internal/api/routes.go:220 |
| PUT /api/org/memberships/{membershipId}/status | Suspender/reactivar membresía legacy | backend-go/internal/api/orgteam.go:308-360; backend-go/internal/api/routes.go:221 |
| POST /api/org/memberships/{membershipCommand...} | Cambiar roles de membership | backend-go/internal/api/orgteam.go:258-264; backend-go/internal/api/orgteam.go:266-302; backend-go/internal/api/routes.go:122-232; backend-go/internal/api/orgteam.go:314-320; backend-go/internal/api/orgteam.go:328-373; backend-go/internal/api/orgteam.go:324-326; backend-go/internal/api/orgteam.go:377-419; backend-go/internal/api/orgteam.go:424-471; backend-go/internal/api/orgteam.go:492-531; backend-go/internal/api/orgteam.go:533-573; backend-go/internal/api/orgteam.go:582-615 |
| GET /api/org/invitations | Listar invitaciones visibles | backend-go/internal/api/orgteam.go:742-757; backend-go/internal/api/routes.go:122-232 |
| POST /api/org/invitations | Crear invitación 14d | backend-go/internal/api/orgteam.go:759-809; backend-go/internal/api/routes.go:122-232 |
| POST /api/org/invitations/{invitationCommand...} | Dispatch resend/revoke de invitación | backend-go/internal/api/orgteam.go:842-857; backend-go/internal/api/orgteam.go:811-838; backend-go/internal/api/orgteam.go:858-889; backend-go/internal/api/orgteam.go:891-909; backend-go/internal/api/routes.go:122-232 |
| POST /api/auth/invitations:accept | Onboarding Web por token de invitación | backend-go/internal/api/platform.go:359-436; backend-go/internal/api/routes.go:122-232 |
| ANY /api/furniture/authoring/resolve | Resolver snapshot semántico de autoría | backend-go/internal/api/authoring_resolve.go |
| GET /api/customers | CRUD clientes con owner | backend-go/internal/api/handlers.go |
| POST /api/customers | CRUD clientes con owner | backend-go/internal/api/handlers.go |
| GET /api/customers/{id} | CRUD clientes con owner | backend-go/internal/api/handlers.go |
| PUT /api/customers/{id} | CRUD clientes con owner | backend-go/internal/api/handlers.go |
| DELETE /api/customers/{id} | CRUD clientes con owner | backend-go/internal/api/handlers.go |
| GET /api/catalog/materials | CRUD catálogo materiales/herrajes | backend-go/internal/api/handlers.go:1124-1263; backend-go/internal/api/handlers.go:1701-1828 |
| POST /api/catalog/materials | CRUD catálogo materiales/herrajes | backend-go/internal/api/handlers.go:1124-1263; backend-go/internal/api/handlers.go:1701-1828 |
| GET /api/catalog/materials/{id} | CRUD catálogo materiales/herrajes | backend-go/internal/api/handlers.go:1124-1263; backend-go/internal/api/handlers.go:1701-1828 |
| PUT /api/catalog/materials/{id} | CRUD catálogo materiales/herrajes | backend-go/internal/api/handlers.go:1124-1263; backend-go/internal/api/handlers.go:1701-1828 |
| DELETE /api/catalog/materials/{id} | CRUD catálogo materiales/herrajes | backend-go/internal/api/handlers.go:1124-1263; backend-go/internal/api/handlers.go:1701-1828 |
| GET /api/catalog/ambient-materials | CRUD acabados de presentación | backend-go/internal/api/ambient.go |
| POST /api/catalog/ambient-materials | CRUD acabados de presentación | backend-go/internal/api/ambient.go |
| GET /api/catalog/ambient-materials/{id} | CRUD acabados de presentación | backend-go/internal/api/ambient.go |
| PUT /api/catalog/ambient-materials/{id} | CRUD acabados de presentación | backend-go/internal/api/ambient.go |
| DELETE /api/catalog/ambient-materials/{id} | CRUD acabados de presentación | backend-go/internal/api/ambient.go |
| GET /api/catalog/ambient-categories | Jerarquía categorías de acabados | backend-go/internal/api/ambient.go |
| POST /api/catalog/ambient-categories | Jerarquía categorías de acabados | backend-go/internal/api/ambient.go |
| GET /api/catalog/ambient-categories/{id} | Jerarquía categorías de acabados | backend-go/internal/api/ambient.go |
| PUT /api/catalog/ambient-categories/{id} | Jerarquía categorías de acabados | backend-go/internal/api/ambient.go |
| DELETE /api/catalog/ambient-categories/{id} | Jerarquía categorías de acabados | backend-go/internal/api/ambient.go |
| GET /api/catalog/material-categories | Jerarquía subgrupos tableros | backend-go/internal/api/materialCategories.go |
| POST /api/catalog/material-categories | Jerarquía subgrupos tableros | backend-go/internal/api/materialCategories.go |
| GET /api/catalog/material-categories/{id} | Jerarquía subgrupos tableros | backend-go/internal/api/materialCategories.go |
| PUT /api/catalog/material-categories/{id} | Jerarquía subgrupos tableros | backend-go/internal/api/materialCategories.go |
| DELETE /api/catalog/material-categories/{id} | Jerarquía subgrupos tableros | backend-go/internal/api/materialCategories.go |
| GET /api/catalog/edges | CRUD cantos | backend-go/internal/api/handlers.go |
| POST /api/catalog/edges | CRUD cantos | backend-go/internal/api/handlers.go |
| GET /api/catalog/edges/{id} | CRUD cantos | backend-go/internal/api/handlers.go |
| PUT /api/catalog/edges/{id} | CRUD cantos | backend-go/internal/api/handlers.go |
| DELETE /api/catalog/edges/{id} | CRUD cantos | backend-go/internal/api/handlers.go |
| GET /api/catalog/hardware | CRUD catálogo materiales/herrajes | backend-go/internal/api/handlers.go:1124-1263; backend-go/internal/api/handlers.go:1701-1828 |
| POST /api/catalog/hardware | CRUD catálogo materiales/herrajes | backend-go/internal/api/handlers.go:1124-1263; backend-go/internal/api/handlers.go:1701-1828 |
| GET /api/catalog/hardware/{id} | CRUD catálogo materiales/herrajes | backend-go/internal/api/handlers.go:1124-1263; backend-go/internal/api/handlers.go:1701-1828 |
| PUT /api/catalog/hardware/{id} | CRUD catálogo materiales/herrajes | backend-go/internal/api/handlers.go:1124-1263; backend-go/internal/api/handlers.go:1701-1828 |
| DELETE /api/catalog/hardware/{id} | CRUD catálogo materiales/herrajes | backend-go/internal/api/handlers.go:1124-1263; backend-go/internal/api/handlers.go:1701-1828 |
| GET /api/catalog/option-groups | CRUD grupos de opciones | backend-go/internal/api/handlers.go |
| POST /api/catalog/option-groups | CRUD grupos de opciones | backend-go/internal/api/handlers.go |
| GET /api/catalog/option-groups/{id} | CRUD grupos de opciones | backend-go/internal/api/handlers.go |
| PUT /api/catalog/option-groups/{id} | CRUD grupos de opciones | backend-go/internal/api/handlers.go |
| DELETE /api/catalog/option-groups/{id} | CRUD grupos de opciones | backend-go/internal/api/handlers.go |
| GET /api/catalog/agregados | CRUD subensambles reutilizables | backend-go/internal/api/agregados.go |
| POST /api/catalog/agregados | CRUD subensambles reutilizables | backend-go/internal/api/agregados.go |
| GET /api/catalog/agregados/{id} | CRUD subensambles reutilizables | backend-go/internal/api/agregados.go |
| PUT /api/catalog/agregados/{id} | CRUD subensambles reutilizables | backend-go/internal/api/agregados.go |
| DELETE /api/catalog/agregados/{id} | CRUD subensambles reutilizables | backend-go/internal/api/agregados.go |
| GET /api/catalog/categories | Jerarquía categorías muebles | backend-go/internal/api/handlers.go |
| POST /api/catalog/categories | Jerarquía categorías muebles | backend-go/internal/api/handlers.go |
| GET /api/catalog/categories/{id} | Jerarquía categorías muebles | backend-go/internal/api/handlers.go |
| PUT /api/catalog/categories/{id} | Jerarquía categorías muebles | backend-go/internal/api/handlers.go |
| DELETE /api/catalog/categories/{id} | Jerarquía categorías muebles | backend-go/internal/api/handlers.go |
| GET /api/catalog/modules | CRUD muebles plantilla | backend-go/internal/api/handlers.go |
| POST /api/catalog/modules | CRUD muebles plantilla | backend-go/internal/api/handlers.go |
| GET /api/catalog/modules/{id} | CRUD muebles plantilla | backend-go/internal/api/handlers.go |
| PUT /api/catalog/modules/{id} | CRUD muebles plantilla | backend-go/internal/api/handlers.go |
| DELETE /api/catalog/modules/{id} | CRUD muebles plantilla | backend-go/internal/api/handlers.go |
| GET /api/catalog/structures | CRUD estructuras | backend-go/internal/api/handlers.go |
| POST /api/catalog/structures | CRUD estructuras | backend-go/internal/api/handlers.go |
| GET /api/catalog/structures/{id} | CRUD estructuras | backend-go/internal/api/handlers.go |
| PUT /api/catalog/structures/{id} | CRUD estructuras | backend-go/internal/api/handlers.go |
| DELETE /api/catalog/structures/{id} | CRUD estructuras | backend-go/internal/api/handlers.go |
| GET /api/catalog/components | CRUD componentes paramétricos | backend-go/internal/api/handlers.go |
| POST /api/catalog/components | CRUD componentes paramétricos | backend-go/internal/api/handlers.go |
| GET /api/catalog/components/{id} | CRUD componentes paramétricos | backend-go/internal/api/handlers.go |
| PUT /api/catalog/components/{id} | CRUD componentes paramétricos | backend-go/internal/api/handlers.go |
| DELETE /api/catalog/components/{id} | CRUD componentes paramétricos | backend-go/internal/api/handlers.go |
| GET /api/projects/{id} | Leer/eliminar proyecto con filtros | backend-go/internal/api/handlers.go |
| DELETE /api/projects/{id} | Leer/eliminar proyecto con filtros | backend-go/internal/api/handlers.go |
| GET /api/projects/{projectId}/furniture-instances | Lista/crea identidad física de proyecto | backend-go/internal/api/furniture_instances.go |
| POST /api/projects/{projectId}/furniture-instances | Lista/crea identidad física de proyecto | backend-go/internal/api/furniture_instances.go |
| POST /api/projects/{projectId}/furniture-instances/{instanceCommand...} | Duplicar unidad en mismo proyecto | backend-go/internal/api/furniture_instances.go |
| POST /api/furniture-instances/{instanceCommand...} | Retirar identidad física terminal | backend-go/internal/api/furniture_instances.go |
| GET /api/projects/{projectId}/quote-lines/{quoteLineId}/furniture-instances | Consultar unidades por línea cotización | backend-go/internal/api/quote_line_furniture_instances.go |
| POST /api/projects/{projectId}/quote-lines/{quoteLineCommand...} | Converger cantidad cotizada a unidades físicas | backend-go/internal/api/quote_line_furniture_instances.go |
| GET /api/projects/{projectId}/designs | Leer diseños y revisiones | backend-go/internal/api/designs.go |
| GET /api/designs/{designId} | Leer diseños y revisiones | backend-go/internal/api/designs.go |
| GET /api/designs/{designId}/working-copy | Leer borrador de diseño | backend-go/internal/api/designs.go |
| POST /api/designs/{designId}/working-copy:reset | Reset borrador desde revisión | backend-go/internal/api/designs.go |
| GET /api/designs/{designId}/revisions | Leer diseños y revisiones | backend-go/internal/api/designs.go |
| POST /api/projects/{projectId}/designs/{designId}/binding:validate | Validar enlace de modelo contra contexto autoritativo | backend-go/internal/api/design_binding.go |
| POST /api/designs/{designId}/publish/{sessionId}/artifacts/{kind} | Subir artefacto a sesión publicación | backend-go/internal/api/design_publish.go |
| POST /api/designs/{designId}/publish/{publishCommand...} | Finalizar revisión inmutable | backend-go/internal/api/design_publish.go |
| GET /api/designs/{designId}/revisions/{revisionId}/artifacts | Listar metadata artefactos publicados | backend-go/internal/api/design_publish.go |
| POST /api/designs/{designId}/revisions/{revisionId}/artifacts/{artifactCommand...} | Grant de lectura artefacto publicado | backend-go/internal/api/design_publish.go |
| GET /api/design-artifacts/{key...} | Streaming de artefacto exacto | backend-go/internal/api/design_publish.go |
| POST /api/projects/{id}/floor-scan | Avanzar piso legacy por línea | backend-go/internal/api/floorScan.go |
| GET /api/projects/{id}/loading-status | Leer eventos de piso y carga | backend-go/internal/api/floorScan.go |
| PATCH /api/projects/{id}/items/{itemId}/floor-status | Avanzar piso legacy por línea | backend-go/internal/api/floorScan.go |
| GET /api/projects/{id}/floor-events | Leer eventos de piso y carga | backend-go/internal/api/floorScan.go |
| GET /api/projects/{id}/part-executions | Leer piezas/unidades físicas | backend-go/internal/api/partExecutions.go |
| PUT /api/projects/{id}/part-executions | Generar/reemplazar ejecuciones físicas | backend-go/internal/api/partExecutions.go |
| POST /api/projects/{id}/parts/{partId}/rework | Retrabajar/refabricar pieza | backend-go/internal/api/partExecutions.go |
| POST /api/projects/{id}/units/{unitId}/advance | Avanzar unidad física | backend-go/internal/api/partExecutions.go |
| POST /api/projects/{id}/units/{unitId}/assembly-override | Override de armado | backend-go/internal/api/partExecutions.go |
| GET /api/projects/{id}/materials | Leer planificación y disponibilidad | backend-go/internal/api/materialPlanning.go |
| POST /api/projects/{id}/materials/derive | Derivar requerimientos de BOM liberado | backend-go/internal/api/materialPlanning.go |
| POST /api/projects/{id}/materials/reserve | Reservar material disponible | backend-go/internal/api/materialPlanning.go |
| POST /api/projects/{id}/materials/consume | Consumir reservas planeadas | backend-go/internal/api/materialPlanning.go |
| POST /api/projects/{id}/materials/release | Liberar materiales con evidencia | backend-go/internal/api/materialPlanning.go |
| GET /api/projects/{id}/quality | Calidad y retrabajos | backend-go/internal/api/quality.go |
| POST /api/projects/{id}/quality/issue | Calidad y retrabajos | backend-go/internal/api/quality.go |
| POST /api/projects/{id}/quality/issue/{issueId}/transition | Calidad y retrabajos | backend-go/internal/api/quality.go |
| POST /api/projects/{id}/quality/rework | Calidad y retrabajos | backend-go/internal/api/quality.go |
| POST /api/projects/{id}/quality/qc/{unitId}/override | Override QC para packaging | backend-go/internal/api/quality.go |
| GET /api/projects/{id}/installation | Leer instalación y closeout readiness | backend-go/internal/api/installation.go |
| GET /api/projects/{id}/costing | Ver costos reales vs estimado | backend-go/internal/api/jobCosting.go |
| POST /api/projects/{id}/costing/baseline | Baseline y tarifa costos | backend-go/internal/api/jobCosting.go |
| POST /api/projects/{id}/costing/labor-rate | Baseline y tarifa costos | backend-go/internal/api/jobCosting.go |
| POST /api/projects/{id}/costing/time | Registrar tiempo real | backend-go/internal/api/jobCosting.go |
| POST /api/projects/{id}/costing/time/{entryId}/void | Anular costo sin borrar historial | backend-go/internal/api/jobCosting.go |
| POST /api/projects/{id}/costing/other | Registrar costo externo | backend-go/internal/api/jobCosting.go |
| POST /api/projects/{id}/costing/other/{costId}/void | Anular costo sin borrar historial | backend-go/internal/api/jobCosting.go |
| GET /api/projects/{id}/site-survey | Leer/iniciar levantamiento | backend-go/internal/api/siteSurvey.go |
| POST /api/projects/{id}/site-survey | Leer/iniciar levantamiento | backend-go/internal/api/siteSurvey.go |
| PUT /api/projects/{id}/site-survey/spaces | Mantener espacios de levantamiento | backend-go/internal/api/siteSurvey.go |
| DELETE /api/projects/{id}/site-survey/spaces/{spaceId} | Mantener espacios de levantamiento | backend-go/internal/api/siteSurvey.go |
| POST /api/projects/{id}/site-survey/spaces/{spaceId}/capture | Capturar medidas de espacio | backend-go/internal/api/siteSurvey.go |
| POST /api/projects/{id}/site-survey/spaces/{spaceId}/approve | Aprobar medidas espacio | backend-go/internal/api/siteSurvey.go |
| POST /api/projects/{id}/site-survey/verify | Verificar levantamiento completo | backend-go/internal/api/siteSurvey.go |
| POST /api/projects/{id}/site-survey/freeze | Congelar medidas para fabricar | backend-go/internal/api/siteSurvey.go |
| GET /api/projects/{id}/events | Leer/registrar eventos de proyecto | backend-go/internal/api/projectEvents.go |
| POST /api/projects/{id}/events | Leer/registrar eventos de proyecto | backend-go/internal/api/projectEvents.go |
| POST /api/production/activity/claim | Reclamar actividad estación | backend-go/internal/api/productionActivity.go |
| POST /api/production/activity/finish/{activityId} | Finalizar actividad | backend-go/internal/api/productionActivity.go |
| POST /api/production/activity/damage | Reportar daño | backend-go/internal/api/productionActivity.go |
| GET /api/production/dashboard | Métricas producción | backend-go/internal/api/productionActivity.go |
| GET /api/production/active | Actividad activa por sectores | backend-go/internal/api/productionActivity.go |
| PATCH /api/production/damage/{id}/resolve | Resolver reporte daño | backend-go/internal/api/productionActivity.go |
| GET /api/production/operators | Consultar operadores sector | backend-go/internal/api/productionActivity.go |
| GET /api/me/sectors | Sectores del actor | backend-go/internal/api/productionActivity.go |
| GET /api/picking | Consultar estados de picking | backend-go/internal/api/projectPicking.go |
| GET /api/stock | Leer stock e historial | backend-go/internal/api/stock.go |
| PUT /api/stock | Cambiar mínimo de inventario | backend-go/internal/api/stock.go |
| GET /api/stock/movements | Leer stock e historial | backend-go/internal/api/stock.go |
| GET /api/suppliers | CRUD proveedores | backend-go/internal/api/suppliers.go |
| POST /api/suppliers | CRUD proveedores | backend-go/internal/api/suppliers.go |
| PUT /api/suppliers/{id} | CRUD proveedores | backend-go/internal/api/suppliers.go |
| DELETE /api/suppliers/{id} | CRUD proveedores | backend-go/internal/api/suppliers.go |
| GET /api/purchase-orders | Ciclo OC: draft→emitida→recibida/cancelada | backend-go/internal/api/purchaseOrders.go:42-363; backend-go/internal/storage/purchaseOrders.go:269-381; backend-go/internal/api/routes.go:509-515 |
| POST /api/purchase-orders | Ciclo OC: draft→emitida→recibida/cancelada | backend-go/internal/api/purchaseOrders.go:42-363; backend-go/internal/storage/purchaseOrders.go:269-381; backend-go/internal/api/routes.go:509-515 |
| GET /api/purchase-orders/{id} | Ciclo OC: draft→emitida→recibida/cancelada | backend-go/internal/api/purchaseOrders.go:42-363; backend-go/internal/storage/purchaseOrders.go:269-381; backend-go/internal/api/routes.go:509-515 |
| PUT /api/purchase-orders/{id} | Ciclo OC: draft→emitida→recibida/cancelada | backend-go/internal/api/purchaseOrders.go:42-363; backend-go/internal/storage/purchaseOrders.go:269-381; backend-go/internal/api/routes.go:509-515 |
| POST /api/purchase-orders/{id}/emit | Ciclo OC: draft→emitida→recibida/cancelada | backend-go/internal/api/purchaseOrders.go:42-363; backend-go/internal/storage/purchaseOrders.go:269-381; backend-go/internal/api/routes.go:509-515 |
| POST /api/purchase-orders/{id}/cancel | Ciclo OC: draft→emitida→recibida/cancelada | backend-go/internal/api/purchaseOrders.go:42-363; backend-go/internal/storage/purchaseOrders.go:269-381; backend-go/internal/api/routes.go:509-515 |
| POST /api/purchase-orders/{id}/receive | Ciclo OC: draft→emitida→recibida/cancelada | backend-go/internal/api/purchaseOrders.go:42-363; backend-go/internal/storage/purchaseOrders.go:269-381; backend-go/internal/api/routes.go:509-515 |
| GET /api/projects/{id}/photos | Galería de fotos de proyecto | backend-go/internal/api/photos.go |
| POST /api/projects/{id}/photos | Galería de fotos de proyecto | backend-go/internal/api/photos.go |
| PATCH /api/projects/{id}/photos/{photoId} | Editar/eliminar foto proyecto | backend-go/internal/api/photos.go |
| DELETE /api/projects/{id}/photos/{photoId} | Editar/eliminar foto proyecto | backend-go/internal/api/photos.go |
| GET /api/showcase/photos | Consultar galería comercial | backend-go/internal/api/photos.go |
| GET /api/projects/{id}/messages | Leer/publicar mensajes internos | backend-go/internal/api/internal_messages.go |
| POST /api/projects/{id}/messages | Leer/publicar mensajes internos | backend-go/internal/api/internal_messages.go |
| PATCH /api/projects/{id}/technical-workflow | Actualizar workflow técnico legacy | backend-go/internal/api/internal_messages.go |
| GET /api/warranties | CRUD tickets garantía | backend-go/internal/api/warranties.go |
| POST /api/warranties | CRUD tickets garantía | backend-go/internal/api/warranties.go |
| GET /api/warranties/{id} | CRUD tickets garantía | backend-go/internal/api/warranties.go |
| PATCH /api/warranties/{id} | CRUD tickets garantía | backend-go/internal/api/warranties.go |
| DELETE /api/warranties/{id} | CRUD tickets garantía | backend-go/internal/api/warranties.go |
| GET /api/warranties/{id}/photos | Fotos garantía | backend-go/internal/api/warranties.go |
| POST /api/warranties/{id}/photos | Fotos garantía | backend-go/internal/api/warranties.go |
| DELETE /api/warranties/{id}/photos/{photoId} | Fotos garantía | backend-go/internal/api/warranties.go |
| GET /api/project-templates | CRUD plantillas de cotización | backend-go/internal/api/handlers.go |
| POST /api/project-templates | CRUD plantillas de cotización | backend-go/internal/api/handlers.go |
| GET /api/project-templates/{id} | CRUD plantillas de cotización | backend-go/internal/api/handlers.go |
| PUT /api/project-templates/{id} | CRUD plantillas de cotización | backend-go/internal/api/handlers.go |
| DELETE /api/project-templates/{id} | CRUD plantillas de cotización | backend-go/internal/api/handlers.go |
| POST /api/projects/{id}/calculate | Calcular desglose comercial sin persistir | backend-go/internal/api/handlers.go |
| GET /api/assignable-owners | Enumerar responsables asignables | backend-go/internal/api/handlers.go |
| POST /api/seed | Sembrar catálogo explícitamente | backend-go/internal/api/handlers.go |
| POST /api/media | Subir imagen de catálogo | backend-go/internal/api/media.go:21-130 |
| POST /api/media:authorize | Emitir grants de lectura por recurso | backend-go/internal/api/media_authorize.go:29-102 |
| GET /api/media/{name} | Leer recurso multimedia exacto | backend-go/internal/api/media.go:133-196; backend-go/internal/api/routes.go:555-565 |
| GET /api/settings | Leer/actualizar ajustes taller | backend-go/internal/api/handlers.go |
| PUT /api/settings | Leer/actualizar ajustes taller | backend-go/internal/api/handlers.go |
| POST /api/organizations/{id}:suspend | Ejecutar suspend/reactivate/begin-offboarding/terminate | backend-go/internal/api/organization_lifecycle.go:218-283; backend-go/internal/api/routes.go:122-232; backend-go/internal/api/routes.go:32-49; backend-go/internal/api/routes.go:199-205 |
| POST /api/organizations/{id}:reactivate | Ejecutar suspend/reactivate/begin-offboarding/terminate | backend-go/internal/api/organization_lifecycle.go:218-283; backend-go/internal/api/routes.go:122-232; backend-go/internal/api/routes.go:32-49; backend-go/internal/api/routes.go:199-205 |
| POST /api/organizations/{id}:begin-offboarding | Ejecutar suspend/reactivate/begin-offboarding/terminate | backend-go/internal/api/organization_lifecycle.go:218-283; backend-go/internal/api/routes.go:122-232; backend-go/internal/api/routes.go:32-49; backend-go/internal/api/routes.go:199-205 |
| POST /api/organizations/{id}:terminate | Ejecutar suspend/reactivate/begin-offboarding/terminate | backend-go/internal/api/organization_lifecycle.go:218-283; backend-go/internal/api/routes.go:122-232; backend-go/internal/api/routes.go:32-49; backend-go/internal/api/routes.go:199-205 |
| POST /api/org/invitations/{invitationId}:resend | Dispatch resend/revoke de invitación | backend-go/internal/api/orgteam.go:842-857; backend-go/internal/api/orgteam.go:811-838; backend-go/internal/api/orgteam.go:858-889; backend-go/internal/api/orgteam.go:891-909; backend-go/internal/api/routes.go:122-232; backend-go/internal/api/orgteam.go:842-860 |
| POST /api/org/invitations/{invitationId}:revoke | Dispatch resend/revoke de invitación | backend-go/internal/api/orgteam.go:842-857; backend-go/internal/api/orgteam.go:811-838; backend-go/internal/api/orgteam.go:858-889; backend-go/internal/api/orgteam.go:891-909; backend-go/internal/api/routes.go:122-232; backend-go/internal/api/orgteam.go:842-860 |
| POST /api/platform/users/{userId}:set-account-status | Despachar cambio de account status global | backend-go/internal/api/platform.go:263-271; backend-go/internal/api/platform.go:237-261; backend-go/internal/api/routes.go:122-232; backend-go/internal/api/platform.go:263-272; backend-go/internal/api/routes.go:179 |
| POST /api/org/memberships/{membershipId}:change-roles | Cambiar roles de membership | backend-go/internal/api/orgteam.go:258-264; backend-go/internal/api/orgteam.go:266-302; backend-go/internal/api/routes.go:122-232; backend-go/internal/api/routes.go:14-30; backend-go/internal/api/routes.go:217-226 |
| POST /api/org/memberships/{membershipId}:suspend | suspender membership | backend-go/internal/api/orgteam.go:314-320; backend-go/internal/api/orgteam.go:328-373; backend-go/internal/api/routes.go:122-232; backend-go/internal/api/routes.go:14-30; backend-go/internal/api/routes.go:217-226 |
| POST /api/org/memberships/{membershipId}:reactivate | reactivar membership | backend-go/internal/api/orgteam.go:324-326; backend-go/internal/api/orgteam.go:328-373; backend-go/internal/api/routes.go:122-232; backend-go/internal/api/routes.go:14-30; backend-go/internal/api/routes.go:217-226 |
| POST /api/org/memberships/{membershipId}:revoke-sessions | Revocar sesiones de una membership | backend-go/internal/api/orgteam.go:377-419; backend-go/internal/api/routes.go:122-232; backend-go/internal/api/routes.go:14-30; backend-go/internal/api/routes.go:217-226 |
| POST /api/org/memberships/{membershipId}:offboarding-preview | Inventario de responsabilidades antes de baja | backend-go/internal/api/orgteam.go:424-471; backend-go/internal/api/routes.go:122-232; backend-go/internal/api/routes.go:14-30; backend-go/internal/api/routes.go:217-226 |
| POST /api/org/memberships/{membershipId}:transfer-admin | Transferir autoridad admin con versiones origen/destino | backend-go/internal/api/orgteam.go:492-531; backend-go/internal/api/routes.go:122-232; backend-go/internal/api/routes.go:14-30; backend-go/internal/api/routes.go:217-226 |
| POST /api/org/memberships/{membershipId}:change-sectors | Cambiar sectores de membership | backend-go/internal/api/orgteam.go:533-573; backend-go/internal/api/routes.go:122-232; backend-go/internal/api/routes.go:14-30; backend-go/internal/api/routes.go:217-226 |
| POST /api/org/memberships/{membershipId}:offboard | Dar de baja membership con plan reasignación | backend-go/internal/api/orgteam.go:582-615; backend-go/internal/api/routes.go:122-232; backend-go/internal/api/routes.go:14-30; backend-go/internal/api/routes.go:217-226 |
| POST /api/auth/mfa/totp/{factorId}:verify | Verificar y habilitar factor pendiente | backend-go/internal/api/mfa.go:318-366; backend-go/internal/api/mfa.go:189-221; backend-go/internal/api/routes.go:122-232; backend-go/internal/api/mfa.go:148-174; backend-go/internal/api/routes.go:152-154 |
| POST /api/auth/mfa/factors/{factorId}:remove | Revocar factor propio | backend-go/internal/api/mfa.go:370-392; backend-go/internal/api/routes.go:122-232; backend-go/internal/api/mfa.go:148-174; backend-go/internal/api/routes.go:155-157 |
| POST /api/projects/{projectId}/furniture-instances/{instanceId}:duplicate | Duplicar unidad en mismo proyecto | backend-go/internal/api/furniture_instances.go |
| POST /api/projects/{projectId}/quote-lines/{quoteLineId}:materialize | Converger cantidad cotizada a unidades físicas | backend-go/internal/api/quote_line_furniture_instances.go |
| POST /api/furniture-instances/{instanceId}:remove | Retirar identidad física terminal | backend-go/internal/api/furniture_instances.go |
| POST /api/designs/{designId}/revisions/{revisionId}/artifacts/{kind}:authorize | Grant de lectura artefacto publicado | backend-go/internal/api/design_publish.go |

## EPS-F01 — HIGH, confirmado en fuente
El workflow técnico legacy carece de guard específico de capability/owner y permite override sin razón obligatoria. No es DesignRelease ni demuestra fuga cross-tenant. Ver JSON para guardas defensivas requeridas y evidencia.

## Contratos futuros
GET /api/organization-relationships: #453; GET /api/sales-network: #459. OpenAPI x-future-owner confirma que no son rutas runtime faltantes.

## Diferencia importante: atomicidad ≠ idempotencia
La recepción OC usa transacción y FOR UPDATE con saldo restante validado. Eso es más fuerte que el picking en varias solicitudes, pero no certifica deduplicación de retry parcial. Sin reproducción no se declara incidente ni se duplica BE-002.

## Pendientes concretos
Los alias canónicos se enlazaron a sus dispatchers reales; los dos contratos futuros están separados. Completar consumidores exactos; verificar cada error/campo contra storage y tests de ruta. Instalación tiene revisión previa en endpoint-deep/operational-flows; no se reetiquetó como cobertura nueva.

## Archivos
data/endpoint-supplement.json contiene input/output schemas resueltos de forma acotada, auth/roles, efectos, referencias y UNKNOWN explícitos por registro.
