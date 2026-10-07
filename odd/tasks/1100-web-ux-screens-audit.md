# ODD — #1100: auditoría UX integral de pantallas web (programa impeccable multi-sesión)

- Issue: #1100 (paraguas del programa).
- Autorización: owner en sesión 2026-10-05 ("revisa toda la app react y planeamos el general y luego una por una de las sesiones").
- Lane: ODD (Delegated Direct) usado como **tracker de programa**: una fila por pantalla, actualizada al cierre de cada sesión. No es la autorización de writes; cada sesión de fixes exige su issue/slice propia.
- Base del censo: `main` @ `ded78877` (2026-10-05). Censo producido por Explorer read-only sobre `apps/web/src` + `packages/ui/src`.
- Estado del programa: **ACTIVO — planeación general entregada, sesiones no iniciadas**.

## 1. Objetivo y bar de cierre

Llevar cada pantalla del censo a una re-critique **≥ 32/40 sin P0/P1 abiertos**, con snapshot persistido en `.impeccable/critique/` y trend verificable. El programa cierra cuando todas las filas están `concluida` o `excluida`, y #1009/#1019/#1032 se cierran tras sus re-critiques.

**Meta aceptada por el owner (2026-10-06), en tres capas:** (1) **Piso: 32/40 sin P0/P1** — ninguna pantalla del demo por debajo; (2) **Promedio del programa: ≥34** — el conjunto mejor que cualquier pantalla suelta; (3) **Flujos estrella (login, Inicio, Cotizaciones): empujar 36+**. Fundamento: 32 es el tramo alto de «Good» y del techo real de UIs (el método anota que la mayoría de UIs reales puntúa 20-32); los puntos estructuralmente caros (Help, Flexibilidad) se registran como deuda de producto, no se infla el score.

## 2. Leyenda de estados por pantalla

| Estado | Significado |
| --- | --- |
| `planeada` | En cola para su sesión de critique (esta ola). |
| `en_curso` | Sesión de critique o fixes en vuelo. |
| `critique_hecha` | Snapshot de critique persistido; fixes conocidos pendientes de decisión o ya mergeados (ver columna Issue/PR); falta re-critique de cierre. |
| `concluida` | Re-critique ≥ 32/40 sin P0/P1, o aceptación explícita del owner. |
| `excluida` | Fuera de alcance con motivo registrado (§8). |

## 3. Censo y tracker

Rutas según `apps/web/src/routes.ts` / `ShellView.tsx`; archivos principales en `packages/ui/src` salvo indicación. "Ln" = archivo principal, orientativo.

### Pre-shell (SessionGate, previo al AppShell)

| # | Pantalla | Ruta/entrada | Archivo principal | Estado | Score | Issue/PR | Sesión |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | Login (+ invitado) | pre-sesión | `auth/LoginScreen.tsx` (170 ln) | concluida | 33/40 (grupo S1) | #1108 (PR feat/1108-s1-preshell-ux) | S1 ✅ |
| P2 | Aceptar invitación | `/accept-invitation?token=` | `auth/AcceptInvitationScreen.tsx` (188 ln) | concluida | 33/40 (grupo S1) | #1108 + preview backend (migración 000156) | S1 ✅ |
| P3 | OrgPicker + splash + error de workspace + handoff invitado | pre-sesión / error | `apps/web/src/OrgPicker.tsx` (133 ln) + `SessionGate.tsx` + `AppContent.tsx` ~1800 | concluida | 33/40 (grupo S1) | #1108; OrgPicker browser NOT_RUN (requiere login real) | S1 ✅ |

### Trabajo / Ventas

| # | Pantalla | Ruta | Archivo principal | Estado | Score | Issue/PR | Sesión |
| --- | --- | --- | --- | --- | --- | --- | --- |
| V1 | Inicio (+ tour onboarding) | `/` | `dashboard/Dashboard.tsx` (675 ln) | concluida | 37/40 | #1116 (PR feat/1116-s2-inicio-tour) | S2 ✅ |
| V2 | Estado de Planta | `/plant-board` | `production/PlantBoardScreen.tsx` (174 ln) | concluida | 34/40 | #1173 (PR, cierre) | S12 ✅ |
| V3 | Dashboard Ventas | `/sales-dashboard` | `sales/SalesDashboard.tsx` (455 ln) | concluida | 32/40 | #1142 (PR feat/1142-s6-ventas) | S6 ✅ |
| V4 | Cotizaciones (lista) | `/quotes` | `projects/ProjectsScreen.tsx` (1022 ln) | concluida | 37/40 | #1118 (PR feat/1118-s3-quotes) | S3 ✅ |
| V5 | Detalle de cotización | `/quotes/:id` | `projects/components/ProjectDetailView.tsx` (1022 ln + detail/) | concluida | 36/40 | #1124 (PR feat/1124-s4-detail) | S4 ✅ |
| V6 | Clientes (+ WhatsApp modal) | `/customers` | `customers/CustomersScreen.tsx` (527 ln) | concluida | 37/40 | #1127 (PR feat/1127-s5-customers) | S5 ✅ |
| V7 | Vitrina | `/showcase` | `showcase/ShowcaseScreen.tsx` (89 ln + portfolio) | concluida | 30→32+ | #1142 (PR feat/1142-s6-ventas; corrección eb535ed2) | S6 ✅ |

### Hilo digital (Diseño)

| # | Pantalla | Ruta | Archivo principal | Estado | Score | Issue/PR | Sesión |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D1 | Muebles del proyecto | `/quotes/:id/muebles` | `digitalThread/ProjectFurnitureScreen.tsx` (1384 ln) | planeada | — | — | S15 |
| D2 | Diseños | `/quotes/:id/disenos` | `digitalThread/ProjectDesignsScreen.tsx` (2038 ln) | planeada | — | — | S14 |
| D3 | Reconciliación | `/quotes/:id/reconciliacion` | `digitalThread/ProjectReconciliationScreen.tsx` (1503 ln) | planeada | — | — | S16 |
| D4 | Proyectar (spatial studio) | sin entrada (dormido) | `projects/components/ProjectSpatialStudio.tsx` (6209 ln) | excluida (pend. owner) | — | #729 `demoExperience.proyectarVisible=false` | — |

### Producción / Ingeniería / Almacén

| # | Pantalla | Ruta | Archivo principal | Estado | Score | Issue/PR | Sesión |
| --- | --- | --- | --- | --- | --- | --- | --- |
| O1 | Dashboard Producción | `/production-dashboard` | `production/ProductionManagerDashboard.tsx` (288 ln) | concluida | 34/40 (proy.) | #1173 (PR, cierre) | S12 ✅ |
| O2 | Órdenes (hub + tabs) | `/orders(/:projectId/:tab)` | `production/ProductionWorkspace.tsx` → `ProductionOrderHub.tsx` (~12 tabs) | planeada | — | nav marcada TEMPORARY (M2) | S8-S9 |
| O3 | Producción (fábrica/estaciones) | `/production` | `production/FabricScreen.tsx` (871 ln) | concluida | 32/40 | #1145 (PR feat/1145-s7-fabric) | S7 ✅ |
| O4 | Instalaciones | `/installations(/:projectId)` | `production/InstalacionesScreen.tsx` (191 ln + detail) | concluida | 35/40 | #1169 (PR #1179, cierre) | S11 ✅ |
| O5 | Embarques | `/shipments(/:projectId)` | `production/EmbarquesScreen.tsx` (174 ln + detail) | concluida | 36/40 | #1169 (PR #1179, cierre) | S11 ✅ |
| E1 | Dashboard Ingeniería | `/engineering-dashboard` | `engineering/EngineeringDashboard.tsx` (205 ln) | concluida | 32/40 | #1183 (PR, cierre) | S13 ✅ |
| E2 | Ingeniería (workspace) | `/engineering(/:projectId)` | `engineering/EngineeringScreen.tsx` → `EngineeringWorkspace.tsx` | planeada | — | referencia migrada (baseline ago) | S13 |
| A1 | Dashboard Almacén | `/warehouse-dashboard` | `purchasing/WarehouseDashboard.tsx` (434 ln) | concluida | 34/40 | #1173 (PR, cierre) | S12 ✅ |
| A2 | Almacén (stock/POs/planning) | `/warehouse` | `purchasing/PurchasingScreen.tsx` (864 ln) | concluida | 34/40 | #1165 (PR feat/1165-s10-almacen) | S10 ✅ |

### Librería

| # | Pantalla | Ruta | Archivo principal | Estado | Score | Issue/PR | Sesión |
| --- | --- | --- | --- | --- | --- | --- | --- |
| L1 | Muebles (lista + editor form) | `/modules(/:id)` | `modules/ModulesScreen.tsx` (519 ln) + `editor/ModuleEditorForm.tsx` | planeada | — | — | S17 |
| L2 | Muebles (board 2D + 3D) | `/modules/:id/edit` | `apps/web/src/components/BoardEditor.tsx` + `Module3DModal` | planeada | — | — | S18 |
| L3 | Estructuras | `/structures(/:id)` | `structures/StructuresScreen.tsx` (601 ln) | planeada | — | — | S19 |
| L4 | Agregados | `/add-ons(/:id)` | `agregados/AgregadosScreen.tsx` (372 ln) + editor | critique_hecha | 24/40 | #1009 (fixes mergeados) | S21 |
| L5 | Componentes | `/components(/:id)` | `components/ComponentsScreen.tsx` (633 ln) + editor | critique_hecha | 26/40 | #1019 (fixes mergeados) | S22 |
| L6 | Grupos | `/option-groups` | `optionGroups/OptionGroupsScreen.tsx` (602 ln) | planeada | — | — | S20 |

### Catálogos

| # | Pantalla | Ruta | Archivo principal | Estado | Score | Issue/PR | Sesión |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | Materiales | `/materials` | `catalogs/materials/MaterialsCatalog.tsx` (772 ln) | critique_hecha | 19/40 (grupo) | #1032 K1-K5 mergeados | S23 |
| C2 | Cantos | `/edges` | `catalogs/EdgesCatalog.tsx` (555 ln) | critique_hecha | 19/40 (grupo) | #1032 | S23 |
| C3 | Herrajes | `/hardware` | `catalogs/hardware/HardwareCatalog.tsx` (505 ln) | critique_hecha | 19/40 (grupo) | #1032 | S24 |
| C4 | Perfiles de herrajes | `/hardware-profiles` | `catalogs/hardware/HardwareProfilesCatalog.tsx` (445 ln) | critique_hecha | 19/40 (grupo) | #1032 | S24 |
| C5 | Acabados | `/finishes` | `catalogs/ambient/AmbientMaterialsCatalog.tsx` (620 ln) | critique_hecha | 19/40 (grupo) | #1032 | S25 |

### Config / Admin

| # | Pantalla | Ruta | Archivo principal | Estado | Score | Issue/PR | Sesión |
| --- | --- | --- | --- | --- | --- | --- | --- |
| G1 | Ajustes (+construcción/máquinas/red ventas) | `/settings` | `settings/SettingsScreen.tsx` (565 ln) | planeada | — | — | S26 |
| G2 | Dispositivos | `/devices` | `settings/DevicesScreen.tsx` (250 ln) | planeada | — | — | S27 |
| G3 | Seguridad | `/security` | `security/SecurityScreen.tsx` (435 ln) | planeada | — | — | S27 |
| G4 | Usuarios (+ ciclo de vida equipo) | `/users` | `users/UsersScreen.tsx` (1105 ln) | planeada | — | fetch sin error recuperable (baseline ago) | S28 |
| G5 | Plataforma (interno) | `/platform` | `platform/PlatformScreen.tsx` (1025 ln) | planeada | — | — | S29 |

### Excluidas del censo

| Superficie | Motivo |
| --- | --- |
| `ProjectSpatialStudio` (Proyectar) | Dormido: sin entrada de UI (#729). Re-auditar sólo si el owner lo reactiva. |
| `usability/UsabilityBenchmarkPanel` | Dev-only (flag localStorage, F148/#314). |
| `apps/web/src/SupportBanner` | Banner interno de soporte, no pantalla. |
| `packages/ui/src/placeholder.tsx` | Código muerto (export nunca renderizado) — candidato a retiro en Ola 0, no a audit. |
| Apps SketchUp / mobile / desktop | Fuera de alcance web de #1100. |

## 4. Protocolo por sesión (una pantalla, una sesión)

1. **Arranque**: `factory_preflight.py` + `impeccable context --target <pantalla>`; leer la fila del censo y el snapshot previo si existe (trend).
2. **Critique** según `.agents/skills/impeccable/reference/critique.md`: doble agente aislado (A: review de diseño con heurísticas Nielsen + carga cognitiva + personas; B: `impeccable detect` + browser con overlay). Snapshot persistido vía `critique-storage write`; trend leído.
3. **Decisión del owner**: los hallazgos P0-P1 se proponen como issues (o se suman a la issue de la pantalla si existe); el owner elige alcance de fixes.
4. **Fixes**: slices con PR estándar del repo (Conventional Commits; invariante UI de AGENTS.md: tokens, copy español, una primary action contextual, estados loading/error/stale/offline/blocked distintos, a11y demostrada; `docs/design.md` §8 al cerrar UI).
5. **Re-critique de cierre**: aplica la bar del §1; actualizar esta fila (estado, score, issues/PRs) y el log §6.
6. **Sin fixes esa sesión** (sólo critique): la fila queda `critique_hecha` con issues fileadas pendientes de decisión.

Regla anti-bucle: máximo una ronda de re-critique por pantalla por ola; si no alcanza la bar, se registran los hallazgos restantes y el owner decide.

## 5. Orden de sesiones (propuesta — decisión pendiente del owner)

Criterio: camino de la DEMO primero (nav simplificada OC-092: Inicio/Cotizaciones/Órdenes/Almacén/Instalaciones), luego ingeniería/hilo digital, librería, catálogos (cierra #1032), config/admin.

| Sesión | Unidad | Ola |
| --- | --- | --- |
| S0 | Transversal: contraste AA tokens (text-muted, warning-700) + test por par, touch 44px, labels "Dashboard" duplicados, retiro `placeholder.tsx` | 0 |
| S1 | Pre-shell completo (P1-P3) | 1 · demo |
| S2 | Inicio + tour (V1) | 1 |
| S3 | Cotizaciones lista (V4) — re-critique de referencia | 1 |
| S4 | Detalle de cotización (V5) | 1 |
| S5 | Clientes (V6) | 1 |
| S6 | Dashboard Ventas + Vitrina (V3, V7) | 1 |
| S7 | Producción/fábrica (O3) | 1 |
| S8 | Órdenes hub parte 1: hub + summary/modules/floor (O2) | 1 |
| S9 | Órdenes hub parte 2: cutlist/labels/hardware/views/optimization/documents (O2) | 1 |
| S10 | Almacén (A2) | 1 |
| S11 | Instalaciones + Embarques (O4, O5) | 1 |
| S12 | Trío monitoreo: Dashboards Producción/Almacén + Planta (O1, A1, V2) | 1 |
| S13 | Ingeniería workspace + dashboard (E2, E1) — re-critique de referencia | 2 · ingeniería |
| S14 | Diseños (D2) | 2 |
| S15 | Muebles del proyecto (D1) | 2 |
| S16 | Reconciliación (D3) | 2 |
| S17 | Muebles lista + editor form (L1) | 3 · librería |
| S18 | Muebles board 2D + 3D (L2) | 3 |
| S19 | Estructuras (L3) | 3 |
| S20 | Grupos (L6) | 3 |
| S21 | Agregados re-critique → cierre #1009 (L4) | 3 |
| S22 | Componentes re-critique → cierre #1019 (L5) | 3 |
| S23 | Materiales + Cantos re-critique (C1, C2) | 4 · catálogos |
| S24 | Herrajes + Perfiles re-critique (C3, C4) | 4 |
| S25 | Acabados re-critique → cierre #1032 (C5) | 4 |
| S26 | Ajustes (G1) | 5 · config |
| S27 | Dispositivos + Seguridad (G2, G3) | 5 |
| S28 | Usuarios (G4) | 5 |
| S29 | Plataforma (G5) | 5 |
| S30 | Cierre global: trend por slug, deudas transversales restantes, informe final | 5 |

## 6. Log de sesiones

| Fecha | Sesión | Pantalla | Resultado (score, snapshot, issues, estado final) |
| --- | --- | --- | --- |
| 2026-10-05 | planeación | programa | Censo + ODD creado (#1100); sin critiques ejecutadas esta sesión. |
| 2026-10-05 | S1 | Pre-shell (P1-P3) | Critique dual-agent **29/40**, snapshot `2026-10-05T18-12-08Z__packages-ui-src-auth.md`; detector 0 hallazgos; AA vivo 8/8 PASS; 3 P1 (splash, mapeo errores login, invitación sin contexto) + 2 P2 sin issue aún; OrgPicker browser NOT_RUN (requiere login real). Nota producto: guard OrgPicker dejaría caer en silencio a un usuario Free sin fábrica (§8.5). |
| 2026-10-05 | S1 fixes | Pre-shell (P1-P3) | Issue **#1108** aprobada en sesión ("hagamos toda S1" + renombre «Explorar modo demo»). Slice backend+web: endpoint read-only `POST /auth/invitations:preview` (migración renumerada a **000157** por colisión con #1102), mapeo de errores de login por clase, splash con marca, invitación con contexto y autoComplete por caso, OrgPicker tokens/foco/aria, divisor 55% / toggle 44px / dvh. **Re-critique 33/40 sin P0/P1** (bar ≥32), snapshot `2026-10-05T19-28-58Z`, trend 29→33. Evidencia: backend-test.sh PASS con PG efímero, UI 2145 / web 596 / storage-ts 262, typecheck ×3, browser live. Review fresca APPROVED re-confirmada para HEAD f2ef1c3a. CI en NOT_RUN: 3 intentos cancelados por degradación repo-wide de Actions — merge owner pendiente de ventana sana. P3 restantes: Reintentar muerto en estados terminales, 429 preview genérico, elipsis. |
| 2026-10-05 | S2 critique | Inicio + tour (V1) | Critique dual-agent **32/40**, snapshot `2026-10-05T20-28-20Z__packages-ui-src-dashboard.md`; detector 1 warning (side-tab); AA vivo 8/8 PASS; doble primaria del baseline **refutada** (1 sola primaria en vivo). 2 P1: tour modal auto-abierto viola DESIGN.md §4.9 (propuesto: opt-in en Inicio) y home de dueño sin foco «¿qué hago hoy?» (~18 elementos, 5 stats juntas, analytics sin colapsar). 2 P2: copy drift ((F090) en producción, tuteo en tour) y stats decorativos. P3: identidad demo (chip Cocina López) + flag del tour por-navegador. Fixes pendientes de decisión del owner. CI #1111 sigue bloqueado (Actions degradado). |
| 2026-10-05 | S2 fixes | Inicio + tour (V1) | Issue **#1116** (owner: alcance completo + regla durable). Branch `feat/1116-s2-inicio-tour` (desde d56fc8c4). Tour opt-in (card + flag, voseo, aria-live), métricas colapsadas + teaser real, embudo 4 KPIs, períodos group/aria-pressed, franja «Seguí donde dejaste» (fail-closed), 4 stats navegables, chip Demo, (F090) fuera, CSS dedupe. **Re-critique 37/40 sin P0/P1** (trend 32→37, snapshot `2026-10-05T21-13-03Z`). UI 2147/2147, web 590/590, browser live. Review fresca APPROVED (2112acba). PR **#1117** — CI con fallos pre-existentes del browser gate (ver fila S3 fixes). P3 registrados en ODD §8/PR. |
| 2026-10-05 | S3 critique | Cotizaciones lista (V4) | Critique dual-agent **33/40**, snapshot `2026-10-05T21-26-48Z__packages-ui-src-projects-projectsscreen.md`; detector limpio; AA 7/7 PASS. **P1×2 confirmados en vivo**: estado `unavailable` muerto (invitado en «Cargando…» eterno, chips congelados) y stale computado pero descartado (sólo Inicio lo consumía). P2: sin orden, sin paginación/contadores. P3: prop de error sin usar. |
| 2026-10-05 | S3 fixes | Cotizaciones lista (V4) | Issue **#1118** (alcance completo). Implementado: idle→unavailable espejando Inicio (banner + badge + chips explicados), stale banner + Reintentar (con corrección del wiring del retry detectada por la re-critique), orden por actividad comercial + control Recientes/Monto/Cliente, paginación 24+24 + contadores por chip, meta tridígito, error prop, «Actualizada», leyenda de montos. **Re-critique 37/40 sin P0/P1** (trend 33→37, snapshot `2026-10-05T22-15-31Z`). Evidencia: src/projects 427/427, UI 2152/2152, typecheck limpio (fixtures TS corregidos tras review), browser live. Review fresca APPROVED (9d712678). PR **#1121**. P3 deferidos con rationale: sort sin gating, banner sin CTA de login. |
| 2026-10-05 | CI diagnóstico | browser gate (transversal) | **Causa raíz confirmada**: degradación de imagen/capacidad del runner (ubuntu-latest → migración Ubuntu 26). Mismo spec 4/4 local en main (17.5s) y en merge-ref #1117 (16.7s); shards en CI 20× más lentos con Failed to fetch bajo carga; CI verde a las 18:34 y roto desde 21:12. Issue **#1122** + experimento pin ubuntu-24.04 → PR **#1123**: shards VOLVIERON VERDE. #1117/#1121 desbloqueados al mergear #1123 (decisión pin permanente vs reporte GitHub, del owner). |
| 2026-10-05 | S4 fixes | Detalle cotización (V5) | Issue **#1124** (alcance completo). Implementado: **P0** — los 9 paneles visibles con authority ready/undefined/empty (sólo loading/error oculta, fail-closed) + nota «Modo lectura» + edición interna gated; **P1** — chromePrimary arbitra ciclo comercial vs manufactura (una primaria por estado, perdedora a secundaria) + projectAllowsContentEdit compartido (header/paneles/wrapper); **P2** — roving tabindex + flechas + aria-controls + panel deep-linkable `?panel=` con cleanup al desmontar; **P3** — badges con aria-label sin fontSize inline, H1, «Ciclo de vida y entregas»; aceptación 6 (precio «—» con causa, divergencia Totales/resumen explicada). **Re-critique 36/40 sin P0/P1** (trend 26→36, snapshot `2026-10-05T23-20-08Z`). Evidencia: src/projects 424/424, UI 2149/2149, typecheck 0, browser live 9/9 tabs + roving + URL. Review fresca **APPROVED** (122f1e55, re-ejecutó suites). PR **#1126**. Deuda registrada: authority legacy oculta paneles (preexistente), fusión de regímenes IA, glosario de pestañas, StatusBadge aria-label. |
| 2026-10-06 | cierre S5-S6 | programa | S2 #1117, S3 #1121, S4 #1126 MERGEADAS por el owner; S5 #1141 abierta (CI limpio). S6 critique + issue listas (fixes próxima sesión). Próxima sesión: **fixes S6**. Cola de merges: #1141. |
| 2026-10-05 | cierre del día | programa | 4 sesiones ejecutadas (S1 mergeada; S2/S3/S4 en PRs #1117/#1121/#1126 con review APPROVED). Cola de merges del owner: **#1123 (fix CI) → #1117 → #1121 → #1126**. |
| 2026-10-06 | S6 fixes | Ventas (V3) + Vitrina (V7) | Issue **#1142** (alcance completo). Implementado: **P1** alertas accionables (button → onOpenProject, sección bajo el header) y filas sin botones anidados (link + acciones hermanas, patrón F150); **P1** Vitrina error honesto (showcasePhotosError en store + alert danger + Reintentar); **P2** empty contextual (Nueva cotización / Explorar la vitrina) + handoff persistente (sessionStorage + banner dismissible en la lista — verificado en vivo con persistencia y recarga); **P3** aria-pressed ×6, tokens, foco visible, teclado en cards, voseo. **Descubrimiento: clases alert--* fantasma en todo el repo** → common/alert.css compartido (5 consumidores). **Re-critique: Dashboard 32/40 ✓ bar; Vitrina 30→33 proyectado → 34/40 MEDIDO sobre HEAD final db0ba20d** (snapshots 12-28-35Z sales y 12-40-13Z showcase; trends 23→33 y 28→33→34). Review fresca APPROVED (re-ejecutó suites). CI: primer run de #1143 falla Foundation browser (runner aislado ejecuta ci.yml en PR — mismo síntoma de capacidad que #1142 documentó; re-run en curso). Próxima sesión: **S7 (Producción/Órdenes)**. |
| 2026-10-06 | S7 fixes | Fábrica (O3) | Issue **#1145** (alcance completo). Implementado: **P0** scanner HID conectado a FabricScreen (reuso F089: useHidScanner + playScanFeedback, partCode → pieza de la estación activa, announce assertive, miss inline, contador de sesión); **P1** single-flight por fila (disabled/aria-busy 1.2s), avances por botón alimentan announce/conteo, targets var(--touch-min); **P3** subtítulo stale, EmptyState canónico, CSS muerto (.fabric__tab/.fabric__tabs), readiness warning-700, comment del scanner alineado. **Re-critique 32/40 sin P0/P1** (trend 25→29→32, snapshot `2026-10-06T13-50-08Z__packages-ui-src-production-fabricscreen.md`). Evidencia: src/production 260/260, UI 2174/2174, typecheck 0, tests s7 4/4 (hit/miss/single-flight/announce); en vivo NOT_RUN honesto (RBAC invitado, screenshot). Review fresca APPROVED (60ae5310). PR **#1148**. Deuda: batch atómico (backend), claim/finish sin guard, lector sin emparejar sin hint. Proceso: lección script-crasheado (memoria). PR **#1148** MERGEADA por el owner. |
| 2026-10-06 | S8 fixes | Órdenes hub (O2) | Issue **#1151** (alcance completo). Implementado: **P1** clamp de deep links técnicos → Resumen + banner con label ES y salida a Proyectos; **P1** loading honesto (workspaceLoading cableado store→shellViewCtx→ShellView→workspace — corrección de la re-critique: el fix inicial era código muerto sin la prop); **P1** copy del bloqueo → Documentos; **P2** piso sin primarias duplicadas; **P2** strip de piso en Resumen + Cotizado gated por showCosts. **Re-critique 34/40 sin P0/P1** (trend 32→34, snapshots 12-28-35Z y 15-08-53Z). Review fresca APPROVED (re-ejecutó suites, threading del loading verificado de punta a punta). PR **#1155**. P3 deferidos: disabled de Documentos en bloqueado, countMode del strip, tests de regresión. Próxima sesión: **S9 queda cubierto por este slice (los otros tabs no tenían P0-P1 propios en este critique)** → S10 Producción dashboard o S11 según §5. |
| 2026-10-06 | S10 fixes | Almacén (A2) | Issue **#1165** (alcance completo). Implementado: **P0** búsqueda funcional (matchItem name/email/phone — el matcher default era no-op sin `code`); **P1** picking por línea con progreso «N/M surtidas» (keys consistentes hardwareId/m.key/e.key); **P1** estados de stock honestos («sin registro» ≠ «agotado»); **P2** jerarquía invertida (Material completo primaria, Marcar despachado secundaria); **P2** badge de bloqueo por material agotado; **P2** confirmación destructiva para Cancelar PO y Desactivar proveedor; **P3** tokens AA, aria-label, contador. **Re-critique 34/40 sin P0/P1** (trend 28→34). Review fresca APPROVED (9c200185→re-scored). PR **#1167**. Deuda: escaneo HID en picking, vista por obra. Próxima sesión: **S11 (Instalaciones + Embarques)**. |
| 2026-10-06 | S11 cierre | Instalaciones (O4) + Embarques (O5) | Issue **#1169** (alcance completo). **PR #1179** (rama feat/1169-s11-cierre; el rebasado sobre #1171 mergeado impidió reusar la rama original — sin force push). Implementado: **P2** «Marcar Instalado» con Deshacer (keyed por obra); **P2** filtro «Activas/Cerradas» (visible también con una sola obra cerrada, vacío de Activas explicado); **P2** roles de escaneo (status/alert paridad Paperless); **P2 re-critique** test del cierre destructivo; **P3** progressbar con aria-valuenow + CSS real de la barra de carga (fantasma preexistente), es-MX→es-AR en producción, estados crossAlert/closeConfirm/lastInstalled keyed por obra, testid duplicado resuelto, prop muerta onUndoInstalled fuera. Re-critique 36/40 Embarques · 35/40 Instalaciones sin P0/P1 (snapshot 18-19-19Z; trend 32→35/36). Review fresca APPROVED (aceptación 1-6 verificada por grep; suites production 265/265, typecheck limpio). Deuda: undo role-gated para produccion (fail-closed con toast; ocultar botón sin permiso), es-MX residuales fuera de producción. |
| 2026-10-06 | S12 fixes | Dashboards PM (O1) + Almacén (A1) + Planta (V2) | Issue **#1173** (alcance completo). Implementado: **P0** deep link «Ir a picking» real (handoff sessionStorage `warehouse_picking_focus`: dashboard escribe → PurchasingScreen consume una vez, elige tab con picking pendiente leyendo `initialPicking`, scrollIntoView + resaltado 2.4s en efecto propio — fix B1 de review: el cleanup del efecto consumidor auto-cancelaba rAF/timer); **P0** métricas honestas (todayCompleted/Damages `number|null` → «—» + subtext «sin registro del servidor», fallback local ya no fabrica ceros); **P1** CSS de stat-card--danger/subtext; **P1** filtro de sector con salida a «Todas» que recorta la tabla de obras (`done < total`) con título/empty contextualizados; **P1** refresh stale-while-revalidate (spinner sólo primera carga, aria-busy, banner role=alert si el refresh falla con datos stale); **P2** títulos = nav (Producción/Almacén) + paridad de color sector activo con Planta (brand, no warning) + error con copy humano y detalle secundario; **P3** th scope, hsl→tokens en purchasing.css, precisión falsa fuera, doc comment honesto, métricas sin duplicar. Tests: filtros ida-y-vuelta, fallback honesto, deep link (handoff consumido, resaltado expira con fake timers, no-op con obra desconocida), afterEach(cleanup) añadido al describe S10. Suites 320/320 (production+purchasing), typechecks limpios. Review fresca: 1 blocker (B1) corregido y re-verificación en curso. |
| 2026-10-06 | S13 fixes | Ingeniería dashboard (E1) + workspace (E2) | Issue **#1183** (alcance completo). Critique dual base: E1 28/40 (A) / 21/40 (B) con **P0** confirmado por ambos (KPI «Revisiones promedio» fabricaba `v1.0` sin packs) y **P1** («Rev. 1» sin log); E2 31/40 (A) / 26/40 (B) con header del workspace roto en vivo (5 ghost classes). Implementado: **P0** KPI «—» + causa; **P1** dominio `revision: number|null` + «Rev. —»; **P2** header con CSS real (flex + title tokens), select estilizado con touch 44px, período sólo por `engineeringLog.startedAt` con nota de excluidos (fuera el proxy createdAt/updatedAt), alcance de filtros declarado, chips táctiles (statusChips.css), workload labels --text-sm, «Iniciar» siempre visible, es-AR, banners/⚠ con tokens; **P3** th scope, Limpiar filtros, «Todos los períodos», ciclo «(en curso)», voseo, notice por tab (LIVE_TAB_CAVEAT_ES), --cancelled→progress/done, género chips, tab activo en URL (`?tab=` con replace + fail-closed), button sin divs, `.eng-despiece__print`, aria-hidden/aria-label. **Re-critique: E1 32/40 sin P0/P1 (trend 28→21→32) · E2 31/40 sin P0/P1 (trend 31→26→31)** con 3 P3 remanentes corregidos en 36891e23 («Documentos», voseo, marcador --startable muerto) y re-score final verificado: **E2 32/40 sin P0/P1 (trend 31→26→31→32)**. Detector LIMPIO; ghost sweep 0; suites: ingeniería 67/67, UI 2190/2190, web 598/598, rutas 35/35, typechecks OK. Browser: base RUN (entorno desechable), re-critique NOT_RUN honesto con fixes anclados por tests. Deuda: abrir obra desde el dashboard pierde el pin `?release=` (ShellView:1289 vs :1832); 401 del probe de sesión re-atribuido al shell (no a las pantallas). |
| 2026-10-06 | merges | programa | Owner mergeó #1179 (S11 cierre), #1180 (S12 cierre) y **#1188 (S13 ingeniería)**. Ola 1 completa en main + S13 (primera de la ola 2). Próxima sesión: **S14 — Diseños (D2)**. |
| 2026-10-06 | merges | programa | Owner mergeó #1141 (S5), #1148 (S7), #1155 (S8), #1167 (S10), #1171 (S11 partial). S1-S11 en main. CI del fix de runner (#1123) resuelve los fallos de Foundation browser. |
| 2026-10-06 | S6 critique | Dashboard Ventas (V3) + Vitrina (V7) | Critique dual-agent **23/40 (Dashboard, Pobre)** y **28/40 (Vitrina, Aceptable)** — totales separados por pantalla; snapshots `2026-10-06T02-54-35Z__packages-ui-src-sales.md` y `__packages-ui-src-showcase.md`. Dashboard: datos de taller con jerarquía de ERP — P1 alertas no accionables y al final, P1 botones anidados (HTML inválido + error React en consola), P2 empty sin salida. Vitrina: instrumento de venta real (Modo Showroom anti-PII) — P1 error disfrazado de vacío con instrucciones falsas, P2 handoff vitrina→cotización es memoria (toast), P3 dos idiomas visuales. En vivo: AA PASS, dashboard INALCANZABLE en invitado (RBAC — el comentario del código miente; anotado), detector limpio. Issue **#1142** (alcance completo; exclusiones: monedas, draft precargado, RBAC invitado, fusión de rankings). Fixes = próxima sesión. |
| 2026-10-06 | S5 fixes | Clientes (V6) | Issue **#1127** (alcance completo). Implementado: Clientes (V6) | Issue **#1127** (alcance completo). Implementado: **P0** búsqueda funcional (matchItem name/email/phone normalizados es-UY + dígitos de teléfono; el matcher default exigía `code` inexistente en Customer — no-op verificado en browser); **P1** WhatsApp guardarraíl de formato internacional (error role=alert + envío disabled), click aislado de la fila (stopPropagation en el botón), gating `canMutateCustomers` con la **autoridad real del backend** (`roleCanMutateCustomers` admin|gerente_ventas|vendedor — corrección de la review fresca: canMutateCatalog era el permiso equivocado y regresaba al vendedor); **P2** confirmación inline de Desactivar con autoFocus; menores (contador aria-live, aria-describedby, sentence case, «Proyectos asociados», tokens reales, aria-label WhatsAppButton). **Re-critique 37/40 sin P0/P1** (trend 25→37→37, snapshot `2026-10-06T02-38-35Z`). Evidencia: src/customers 7/7, UI 2166/2166, web 51 files, typecheck 0, browser live del P0/gating/confirmación (WhatsApp guardrail por código+tests: seed sin teléfonos). Review fresca: blocker de autoridad resuelto; veredicto final en curso. PR `feat/1127-s5-customers`. Registrados: h1 sistémico PageHeader (micro-slice), country-code default (producto), último contacto (datos). Próxima sesión: **S6 (Dashboard Ventas + Vitrina)**. |
| 2026-10-05 | S4 critique | Detalle cotización (V5) | Critique dual-agent **26/40 con 1 P0**, snapshot `2026-10-05T22-36-56Z__packages-ui-src-projects-projectsdetailview.md`. **P0: las 9 herramientas del hub (Comunicaciones/Fotos/Garantías/…) desaparecen al publicar** (`!quoteAuthority \|\| empty` gating) — el vendedor pierde el seguimiento al cliente justo al publicar. P1: doble primaria (Gestionar Q2 + Abrir en Producción) y canEditContent divergente. P2: 9 toggles sin tabs/URL. P3: badge-zoo title-only. En vivo: 1 primaria en invitado, sin H1, precio «—» sin causa, typo demo «Bisgras». Issue **#1124** (alcance completo; exclusión: fusión de regímenes IA = evolución mayor). Fixes = próxima sesión. |

## 7. Deudas transversales (baseline 2026-08-19 + DESIGN.md "planned")

Se atacan en S0 las globales y dentro de cada sesión las locales:

- Contraste AA: `--text-muted` 4.13:1, `--warning-700` 3.68:1, placeholder login ~3.08:1 → S0 con test automático por par.
- `--touch-min` 40px → 44px (S0 + auditoría por pantalla).
- Dos nav items "Dashboard" idénticos (`AppShell.tsx:193,212`).
- Rollout `PageHeader`/`PageToolbar` (~18 headers locales), icon-chips de área, atmósfera de área imperceptible (canvas 97% lightness).
- Tabs semánticos (`WorkspaceTabs`/`WorkflowTabs`) vs ~15 tabs locales; `Modal` común vs overlays manuales (SectorAssignment sin `role="dialog"`, CsvExportConfigModal, lightbox, presentation).
- Badges/stats/botones locales paralelos (`catalog-badge`, `sales-badge`, `users-role-badge`, `eng-badge`, primary propia de InternalCommsPanel).
- 129 literales de color y 40 `z-index` sin escala en CSS de feature.
- Atmósfera de área: calibrar canvas/chrome a tinte perceptible.
- Tour auto-open en primer login (§4.9 design.md: ayuda contextual u opt-in).
- Responsive: validación 390/768/1280 por pantalla (compact/medium/expanded, no desktop encogido).

## 8. Decisiones pendientes del owner

1. **Orden**: camino demo primero (§5 propuesto) vs por área temática vs otra prioridad.
2. **Bar de concluida**: ≥ 32/40 sin P0/P1 (propuesto) — ajustable.
3. **Proyectar (D4)**: mantener excluida mientras esté dormido (#729) o reactivarlo para auditar.
4. **Plataforma (G5)**: auditar como el resto o dejar al final/interno (propuesto: S29).
5. **Register / versión Free (producto, fuera de #1100)**: owner 2026-10-05 — volverá el self-register: usuarios entran al plan Free sin fábrica asignada ("huérfanos"). Requiere issue de producto propia; cuando exista la pantalla de Registro se añade al censo y se re-auditan P1/P3. Los critiques del pre-shell tratan el login como estado de transición (el register ausente es decisión deliberada, no defecto).

## 8b. Deudas de diseño registradas (2026-10-06)

1. **ProcessStrip universal**: el componente ya acepta `flow`, `action`, `testIdPrefix`; le faltan `areaColor` (o heredar via `data-area-context`) y `variant` ('strip' horizontal vs 'panel' vertical). Usado en Ingeniería y Órdenes hub; extensible a Fabric, Instalaciones, Embarques.
2. **Patrón hover/touch consistente**: `@media (hover: none)` ya existe en CatalogTable y cardOpen pero falta aplicarlo en ProductionOrderCards, PurchasingCards y otros cards custom con acciones reveladas por hover.
3. **h1 sistémico en PageHeader**: el componente renderiza h2; cambio sistémico con familia de tests propia (micro-slice).
4. **ProductionOrderHub**: swap FabricationFlowSteps → ProcessStrip (hecho en main, 460fb07c).

## 9. Fuentes

- Censo: Explorer read-only 2026-10-05 sobre main @ `ded78877` (rutas `apps/web/src/routes.ts`, `ShellView.tsx`, nav `packages/ui/src/shell/AppShell.tsx`).
- Baseline: `.impeccable/critique/2026-08-19T15-34-57Z__packages-ui-src-todas-las-pantallas-de-la-app-web.md` (28/40).
- Parciales: `.impeccable/critique/` Agregados 2026-10-03 (24/40), Componentes 2026-10-04 (26/40), Catálogos 2026-10-04 (19/40).
- Fixes mergeados: #1009/#1019 (10 slices, C4 #1026/C5 #1027), #1032 (K1-K5: #1033/#1034/#1035/#1038/#1039 — los 5 mergeados 2026-10-04).
- Árbitro de diseño: `docs/DESIGN.md` (+ `docs/design.md` histórico); producto: `docs/PRODUCT.md`.
