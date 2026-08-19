# Critique de estandarización UI — toda la app vs design system v3 (post F100–F102)

> Fecha: 2026-08-19 · Target: todas las pantallas de la app web (`packages/ui/src` + `apps/web/src`)
> Referencia: sistema nuevo definido en `progress/explore_ui_platform_synthesis.md`,
> `explore_ui_design_system_audit.md`, `explore_ui_ux_flow_critique.md` y `docs/design.md` v3.0.
> Los snapshots de critique anteriores fueron eliminados a pedido del dueño; esta es la línea base nueva.

## Design Health Score — Nielsen

| # | Heurística | Score | Hallazgo clave |
|---|---|---:|---|
| 1 | Visibilidad del estado | 3 | `PageLoading`/`EmptyState`/`ScreenBoundary`/toasts existen; `UsersScreen` y varios fetch locales siguen sin error recuperable. |
| 2 | Correspondencia con el mundo real | 4 | Lenguaje de taller intacto («Cotizaciones», «Corte», «Encintado», «Embarques»). |
| 3 | Control y libertad | 2 | Sin undo global; dirty-state guards heterogéneos; mutaciones inmediatas sin rollback (cambio de rol/estado). |
| 4 | Consistencia y estándares | 3 | Las fundaciones existen (PageHeader/PageToolbar/Tabs semánticos), pero la adopción es minoritaria: 3 consumidores de `PageHeader` frente a ~18 pantallas con header local. |
| 5 | Prevención de errores | 3 | RBAC real, confirmaciones destructivas, gating por etapa; faltan guards uniformes de salida con cambios. |
| 6 | Reconocimiento antes que recuerdo | 3 | Cmd/Ctrl+K y labels con texto; persisten 26 destinos para admin y DOS items de nav con label «Dashboard» idéntico (`AppShell.tsx:193,212`). |
| 7 | Flexibilidad y eficiencia | 3 | Cmd+K, deep links, batch de fábrica; sin gramática global de shortcuts/bulk en catálogos y ventas. |
| 8 | Estética y minimalismo | 3 | Sistema sobrio y orientado a tarea; la atmósfera de área no aterriza visualmente y quedan dobles primarias puntuales (Inicio). |
| 9 | Diagnóstico y recuperación de errores | 2 | Varios fetch no modelan error/retry; el fallo de red del login y el error de credenciales conviven sin distinción operable para el usuario. |
| 10 | Ayuda y documentación | 2 | Hints/tooltips parciales; el tour vive lejos del momento de duda; editores complejos sin ayuda contextual. |
| **Total** | | **28/40** | **Aceptable — la base mejoró, la superficie todavía no** |

El 28/40 no significa que F100–F102 no sirvieron: significa que sentaron infraestructura que aún no llega a la mayoría de las pantallas. El score no sube hasta que la adopción se complete.

## Veredicto anti-patrones

**LLM assessment:** No parece una galería AI ni un clon. El register `product` está respetado:
sin gradient text, sin glassmorphism, sin FAB, sin grid de cards icon+título idénticas. El defecto
sigue siendo **familiaridad inconsistente**: el producto se siente como capas de épocas distintas
donde las pantallas migradas (Cotizaciones, Ingeniería) conviven con vocabularios locales.

**Deterministic scan:** `detect.mjs --json packages/ui/src apps/web/src` → **0 hallazgos** (exit 0).

**Visual overlays:** no disponibles (evaluate del navegador es read-only en este runtime). La
evidencia visual se recolectó con screenshots + estilos computados (ver Run Notes en chat).

## Impresión general

La app tiene el sistema correcto y las herramientas correctas; lo que falta es **el rollout**. El
usuario pide «que todas las páginas tengan este nuevo estilo» y hoy el nuevo estilo existe en 3
pantallas. La mayor oportunidad es un pase de estandarización mecánico y verificable: migrar las
~18 pantallas restantes al esqueleto único, calibrar la atmósfera de área para que se perciba,
cerrar contraste AA y consolidar tabs/modales/badges en los primitivos compartidos.

## Lo que funciona

1. **Las fundaciones F100–F102 son reales y están testeadas**: `data-area-context` se propaga
   (verificado en vivo: `/quotes` → `sales`, canvas `rgb(245,250,249)`), `PageHeader`/`PageToolbar`
   son tipados y accesibles, `WorkspaceTabs`/`WorkflowTabs` cubren roles ARIA, roving tabindex y
   overflow de una fila.
2. **Las pantallas migradas demuestran el patrón objetivo**: Cotizaciones e Ingeniería muestran el
   chrome compartido con una primaria por nivel; son la referencia para el resto.
3. **Responsive y higiene de datos aguantan**: a 390px el sidebar colapsa a drawer sin overflow y
   las cards reflowean a 1 columna; fechas humanas («19 ago 2026»), dinero formateado, badges con
   dot+texto y `—` en vacíos verificados en pantalla.

## Issues prioritarios

### [P1] El esqueleto único (§4.1a) tiene adopción minoritaria — 3 de ~21 pantallas
- **Qué:** `PageHeader`/`PageToolbar` sólo en `ProjectsListView`, `EngineeringScreen` y
  `ProductionOrderViewsPanel`. Persisten ~18 headers locales: catálogos (Materiales/Cantos/
  Herrajes/Acabados), Dashboard, SalesDashboard, ProductionManagerDashboard, FabricScreen,
  Users, Settings, Customers, Showcase, Muebles, Estructuras, Componentes, Agregados, Grupos.
- **Por qué importa:** la memoria muscular no se transfiere; cada pantalla re-evalúa dónde están
  filtros, CTA y contexto. Es exactamente el punto de la estandarización pedida.
- **Fix:** olas de migración mecánica por familia (catálogos → librería → producción/almacén →
  config/dashboards), con gate §8 de `docs/design.md` y alias CSS eliminados al migrar.
- **Comando:** `$impeccable polish` (olas por familia) / `$impeccable layout`.

### [P1] La atmósfera de área existe en código pero no se percibe
- **Qué:** canvas `--area-*-canvas` al 97% de lightness (`hsl(170 35% 97%)` sales,
  `hsl(245 55% 97%)` eng). Verificado en vivo y por análisis visual: el canvas se lee «gris
  neutro»; el análisis visual de Cotizaciones y Materiales no detectó tinte fuera del sidebar.
  Además, los headers no migrados no tienen icon-chip de área.
- **Por qué importa:** la identidad de proceso que el usuario quiere («nuevos colores») no aterriza;
  la señal muere en el menú lateral.
- **Fix:** calibrar canvas/chrome a tinte perceptible pero calmo (bajar lightness ~1–2 puntos y/o
  subir croma del canvas y sobre todo del chrome), y completar icon-chips vía el rollout de
  `PageHeader`. Mantener brand/semánticos intactos.
- **Comando:** `$impeccable colorize` (calibración) — la penetración viene del rollout.

### [P1] Contraste AA sigue fallando en tokens de texto y warning
- **Qué (medido):** `--text-muted` (52%) da **4.13:1** sobre blanco y **3.82:1** sobre
  `--surface-app` (usa 197 veces, es el placeholder del search); `--warning-700` sobre
  `--warning-50` da **3.68:1** para texto de badge de 11px.
- **Por qué importa:** incumple el baseline AA de `docs/design.md` §4.8 en jornadas de 8 horas.
- **Fix:** oscurecer `--text-muted` a ≥4.5:1 (o separar rol decorativo de rol legible), oscurecer
  warning-700, y agregar test automático de contraste por par (no comentarios estimados).
- **Comando:** `$impeccable audit`.

### [P1] Tabs semánticos: 3 consumidores, 15 archivos con tabs locales
- **Qué:** `WorkspaceTabs`/`WorkflowTabs` sólo en `EngineeringWorkspace`, `FabricScreen`,
  `ProductionOrderHub`. Implementaciones locales en los 4 editor forms (Module/Structure/
  Component/Agregado), paneles de producción (Despiece/Labels/Paperless), purchasing ×3
  (PurchaseOrders/Stock/PurchasingScreen), Showcase y presentation/spatial studio.
- **Por qué importa:** dos patrones canónicos existen justamente para que no haya variantes
  locales; cada tab local es una excepción que el usuario debe reaprender.
- **Fix:** clasificar cada caso (peer vs workflow) y migrar; los editors usan peer, las estaciones
  workflow.
- **Comando:** `$impeccable polish`.

### [P1] Modales paralelos sin el contrato accesible del `Modal` común
- **Qué:** sólo `ConfirmDialog`, `EntityEditorLayout` y `PurchaseOrdersPanel` usen el primitive.
  `SectorAssignment` ni declara `role="dialog"`; `CsvExportConfigModal`, `OnboardingTourModal`,
  `ProjectsPortfolioView` (lightbox) y `ProjectPresentationMode` implementan overlays manuales
  parciales (sin trap/restore completos).
- **Por qué importa:** teclado y lector de pantalla escapan al fondo; el mismo patrón visual se
  comporta distinto por feature (WCAG 2.1.2/2.4.3/4.1.2).
- **Fix:** `Modal` como única infraestructura; extraer `FullscreenDialog` con el mismo contrato
  para presentation/lightbox.
- **Comando:** `$impeccable harden`.

### [P2] Deuda de vocabularios locales y sistema
- Badges: `catalog-badge`, `sales-badge`, `users-role-badge`, `eng-badge` siguen vivos junto al
  `status-badge` común (`catalogs.css`, `sales.css`, `users.css`, list views).
- Stats: familias locales en dashboard/engineering/production/purchasing/sales conviven con
  `.stat-card`.
- Botones: `InternalCommsPanel` define su propia primary (`internal-comms__action-btn--primary`).
- `--touch-min` sigue en 2.5rem (40px); el estándar v3 exige 44px.
- 129 literales de color y 40 `z-index` sin escala en feature CSS.
- Dos nav items con label «Dashboard» idéntico (`AppShell.tsx:193,212`) — regla de labels únicos §4.1.
- Inicio muestra «Nueva cotización» y «Nuevo mueble» como primarias sólidas simultáneas
  (gramática de acciones §4.1a: una primaria por nivel).
- **Comando:** `$impeccable distill` + `$impeccable adapt` + `$impeccable clarify`.

### [P3] Polish
- Tour de bienvenida auto-abre al primer login (§4.9: ayuda contextual u opt-in, nunca modal).
- Placeholder del login por debajo de AA (blanco 40% sobre input oscuro ≈ 3.08:1, heredado del
  audit anterior — revalidar al tocar login).

## Personas — banderas rojas

**Alex (power user):** Cmd+K y deep links le sirven; pierde tiempo entre 26 destinos de admin y dos
«Dashboard» indistinguibles en la paleta. Los tabs locales de los editors le obligan a reaprender
navegación por workspace.

**Sam (teclado/lector/zoom):** `WorkspaceTabs`/`WorkflowTabs` y `Modal` son excelentes — donde
aplican. `SectorAssignment` sin `role="dialog"` y los overlays manuales le rompen el flujo;
`--text-muted` bajo AA le cuesta lectura sostenida; stat-cards filtro aún sin announce de pressed.

**Jordan (primera vez):** EmptyStates que enseñan y lenguaje de taller le ayudan; el tour auto-open
lo interrumpe en vez de acompañarlo; «Agregados»/«Grupos»/«Órdenes» requieren conocimiento previo
sin hint contextual.

**Vendedor del taller:** la atmósfera sales no se percibe en pantalla (canvas al umbral); el
identidad de área que le diría «estás en tu zona» no llega al contenido.

**Operario / instalación:** pantallas de producción siguen desktop-first con acciones arriba y
targets de 40px; la app móvil nativa es la respuesta de fondo, pero el estándar 44px web no cierra.

## Observaciones menores

- Login: fallo de red y credenciales inválidas producen estados distintos pero el copy de conexión
  aparece también cuando el origen real es configuración (127.0.0.1 vs localhost) — no es bug del
  mapping (401 → «Email o contraseña incorrectos» existe en `session.ts:210`), pero conviene
  distinguir offline de CORS/origen.
- Cotizaciones detalle: el análisis visual marcó competición de primarias en chrome — el código es
  condicional por status (un lifecycle a la vez), validar por pantalla durante el rollout.
- 390px Cotizaciones sin overflow y con drawer correcto (evidencia capturada).

## Preguntas para considerar

- ¿Qué pasaría si la atmósfera de área se percibiera de verdad (canvas/chrome calibrados +
  icon-chips en todas)? ¿Qué parte del valor de «sé dónde estoy» ya se pierde hoy?
- ¿Los 26 destinos de admin se sostienen cuando cada área tenga landing propia?
- ¿La app necesita undo global, o dirty-guards + confirmaciones bastan para el riesgo del taller?

## Notas de ejecución

- Target slug: `packages-ui-src-todas-las-pantallas-de-la-app-web` (snapshot en
  `.impeccable/critique/2026-08-19T15-34-57Z__*.md`).
- Snapshots de critiques anteriores: **eliminados a pedido del dueño** antes de esta corrida
  (19 archivos, jul 16–ago 18). Este es el único backlog activo de polish.
- Assessment independence: secuencial (sesión autónoma, sin sub-agentes) — degraded por diseño.
- Detector CLI: 0 hallazgos en `packages/ui/src` + `apps/web/src`.
- Browser: IAB con Vite dev (127.0.0.1:5173), modo invitado; 9 screenshots (1280×800 + 390×844)
  + estilos computados (verificación `data-area-context`/canvas). Capturas en `/tmp/muebles-critique/`
  (efímeras). Overlay detect.js: no disponible (evaluate read-only en este runtime).
- Login admin: credenciales seed no válidas (401 verificado por curl directo); pantallas
  admin/producción evaluadas por fuente, no en vivo.
- Dev server detenido al finalizar la corrida.

skill_resolution: paths-injected

