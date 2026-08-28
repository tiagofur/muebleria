# Auditoría estática integral del sistema visual

**Resultado:** el sistema tiene una base reusable valiosa, pero todavía no es el
sistema visual coherente que promete `docs/design.md`. El principal problema no
es la paleta: es que el tema de área no tiene un contrato semántico que atraviese
la pantalla, mientras formularios, overlays y estados siguen creando vocabularios
locales. Antes de un polish pantalla por pantalla conviene corregir esa capa.

## Camino rápido de lectura

1. Revisar **Veredicto** y los hallazgos P1.
2. Aprobar la **arquitectura semántica por área**.
3. Corregir primero contraste, modales y primitives; después migrar pantallas.
4. Recién al final hacer screenshot review a 390 / 768 / 1280 px.

## Alcance y método

- Alcance estático: `packages/ui/src`, `apps/web/src`, `docs/design.md` y
  `docs/PRODUCT.md`. La app móvil queda fuera salvo como referencia de target
  táctil (48 dp).
- Primero se resolvió el root con Git y se verificó `.codegraph/`.
- CodeGraph estaba presente, actualizado y cubría 807 archivos / 12.415 nodos.
  Se usó `codegraph_explore` para shell, navegación, screens y dependencias.
- CodeGraph no indexa CSS (su status sólo reporta TypeScript, TSX, Go,
  JavaScript y YAML). Por eso, **después** de CodeGraph, se usó filesystem/rg
  como fallback acotado para los 65 CSS, tokens y clases visuales.
- No se modificó código, documentación, backlog ni WIP del dueño.

## Veredicto anti-patrones

**No parece una “galería AI”**, y eso es un mérito. No hay gradient text,
glassmorphism generalizado, cards con radios absurdos ni una segunda librería de
iconos. Sin embargo, todavía se siente como varias capas de producto construidas
en épocas distintas: un core cuidado convive con CSS local, modales paralelos,
colores sueltos y breakpoints no gobernados. El defecto no es “demasiado
decorativo”; es **familiaridad inconsistente**.

Tells concretos que sí quedan:

- El KPI destacado usa una receta de “hero metric” con gradiente
  (`common/statCard.css:113-137`). No es bloqueante porque el dato es real, pero
  debe ser una excepción explícita, no un template de dashboard.
- Hay custom scrollbars en tabs/tablas (`common/tabs.css:33-44`,
  `common/dataTable.css:33`) y una variante que los oculta en producción
  (`production/production.css:2136-2139`). Es inconsistente con el register
  product y con affordances nativas.
- El activo del sidebar usa una franja izquierda de 3 px
  (`shell/appShell.css:103-113`). Es comprensible como nav, pero contradice el
  ban actual de Impeccable sobre side stripes y debería resolverse explícitamente
  en documentación, no por accidente.

## Audit Health Score

| # | Dimensión | Score | Hallazgo clave |
|---|---|---:|---|
| 1 | Accesibilidad | **2/4** | Contraste AA fallido y overlays fuera del modal común |
| 2 | Performance | **2/4** | Sin lazy de rutas; 20.413 líneas CSS y monolitos por dominio |
| 3 | Responsive | **2/4** | Shell/tablas sólidos, pero target 40 px y 19 cortes distintos |
| 4 | Theming | **2/4** | Tokens buenos, aplicación parcial, 131 colores CSS literales |
| 5 | Anti-patrones | **3/4** | Registro product reconocible; quedan excepciones no gobernadas |
| **Total** |  | **11/20** | **Aceptable — requiere trabajo significativo** |

## Resumen ejecutivo

- **Score:** 11/20 (Aceptable).
- **Issues:** P0 0 · P1 7 · P2 7 · P3 2.
- **Lo más urgente:** contraste, modal único, tokens sin escape hatch,
  primitives de formulario/estados y targets táctiles.
- **La petición de color por área no puede resolverse “pintando más cosas”.**
  Hace falta una capa de roles de área que ambiente canvas/header/toolbar sin
  contaminar acciones ni estados.
- `docs/design.md` no describe con precisión el código actual: tiene valores,
  rutas y reglas en conflicto, y llama “resuelto” a un sistema que todavía tiene
  deuda verificable.

## Inventario del sistema real

### Tokens y fundamentos

| Familia | Estado real | Observación |
|---|---|---|
| Tipografía | Buena base | Inter + fallbacks, escala 11–28 px, mono para códigos |
| Brand | Buena base | Indigo 50–900 + teal; uso de acción mayormente consistente |
| Área | Parcial | Sales/eng/work existen, pero no hay roles ambient/surface/context |
| Superficies | Parcial | App/card/input/hover + viewports 3D; faltan roles de tema por área |
| Semánticos | Parcial | Success/danger/info sólidos; warning tiene contraste insuficiente |
| Espaciado/densidad | Bueno | Escala 4 px + tokens `--density-*` aplicados al core |
| Radios | Buena escala, mala adopción | 4/8/12/16/24/full; 32 literales fuera del token system |
| Elevación | Parcial | Escala xs–xl; 24 sombras literales y z-index sin escala |
| Motion | Parcial | Tokens 150/250/350 ms + fail-safe global reduced motion; 52 duraciones locales |
| Breakpoints | Inconsistente | Canónicos declarados, pero aparecen 19 valores reales |
| Dark mode | No existe | Light-only; no selector ni override de tema |

Magnitud estática:

- 65 CSS, 20.413 líneas.
- Mayores monolitos: `production.css` 2.661, `projects.css` 2.156,
  `components.css` 982, `projectSpatialStudio.css` 853,
  `structures.css` 823, `sales.css` 763.
- 131 literales de color en 17 CSS fuera de tokens/reset.
- 32 `border-radius` literales en 13 CSS.
- 24 `box-shadow` literales en 15 CSS.
- 52 duraciones de transition/animation literales en 18 CSS.
- 41 CSS definen o modifican inputs/selects/textareas.

### Color por área: penetración actual

| Área | Sidebar/topbar | Header de pantalla | Contenido | Veredicto |
|---|---|---|---|---|
| Ventas | Sí | No consistente | Sólo stat-card; `sales.css` usa HSL sueltos | **Insuficiente** |
| Ingeniería | Sí | Parcial/comentario | Muebles usa 3 referencias; el resto neutral | **Insuficiente** |
| Producción/Almacén | Sí | Mejor cobertura | 8 referencias en `production.css` + 3 en manager dashboard | **Parcial** |
| Overview/Config | Neutral | Neutral | Neutral | Coherente si se documenta como cross-area |

Los tokens `--area-*` aparecen fuera de tokens/shell sólo en
`common/statCard.css`, `modules/modules.css`, `production/production.css` y
`production/productionManagerDashboard.css` (más un comentario en
`engineering.css`). No existe un alias contextual del tipo `--area-surface`.
Por eso cada feature decide manualmente si “lleva” color.

### Primitives y adopción

| Primitive | Positivo | Brecha |
|---|---|---|
| Botones | `.btn` único; 383 usos; hover/focus/active/disabled | 182 botones usan chrome propio; 5 icon variants apenas; loading no es estado visual reusable |
| Formularios | `catalog-form` establece label/control/focus | 41 CSS vuelven a estilizar controles; radius/padding/focus divergen |
| Cards | `surface-card`, `entity-card`, `stat-card` extraídos | Base combina borde+sombra contra la regla L1; varias cards locales permanecen |
| Tablas | Scrollport, sticky header, numéricos, focus | Min-height en `td` no garantiza target; varias tablas especiales no usan el primitive |
| Headers | `pageHeader.css` alinea 13 aliases | Sigue siendo una hoja de aliases, no un componente; icon-chip no está normalizado |
| Modal | `Modal.tsx` tiene portal, trap, Esc, restore focus | Al menos 6 overlays/dialogs paralelos no heredan el contrato |
| Status | `status-badge` semántico extraído | `catalog-badge`, `sales-badge`, role/revision/category vocabularies se mezclan |
| Loading/empty | Primitives comunes y reduced-motion global | No hay evidencia estática de cobertura uniforme de los 4 estados por pantalla |

## Hallazgos P1 — resolver antes de declarar excelencia

### [P1] El contrato de color por área contradice el objetivo del producto

- **Ubicación:** `docs/design.md:193-222`, `shell/appShell.css:148-180`,
  `shell/appShell.css:234-255`, `design-system/tokens.css:44-61`.
- **Categoría:** Theming / Organización visual.
- **Evidencia:** §3.2.1 dice explícitamente que el color de área “solo” puede
  existir en sidebar, item activo e icon-chip, y prohíbe superficies, toolbars o
  contenido. El código obedece mayormente esa restricción. Ventas e Ingeniería
  carecen de una atmósfera visual persistente; Producción tiene excepciones
  locales que ya rompen la regla.
- **Impacto:** la orientación depende del menú lateral. Al entrar en una vista
  densa o un workspace, desaparece la señal de proceso; agregar color manual por
  pantalla sólo aumentaría drift.
- **Recomendación:** reemplazar “solo tres lugares” por un tema ambiental
  restrained basado en roles contextuales (propuesta más abajo). Mantener brand
  para acciones y semánticos para estados.
- **Comando sugerido:** `$impeccable colorize`.

### [P1] Tokens de texto y warning no alcanzan contraste AA

- **Ubicación:** `tokens.css:88-94`, `common/searchInput.css:32-34`,
  `auth/login.css:137-170`, `common/statusBadge.css:93-101`.
- **Categoría:** Accessibility / Theming.
- **Evidencia calculada:**
  - `--text-muted` sobre blanco: **4.10:1**; sobre `--surface-app`: **3.82:1**.
  - Placeholder login (white 40% sobre su input oscuro): aprox. **3.08:1**.
  - `--warning-700` sobre `--warning-50`: **3.68:1** para texto de 11 px.
  - `--text-muted` se usa 197 veces y es el color de placeholder del search.
- **Impacto:** labels, hints, placeholders y badges pequeños son difíciles de
  leer en jornadas largas; incumple el baseline WCAG AA de `docs/PRODUCT.md`.
- **WCAG:** 1.4.3 Contrast (Minimum).
- **Recomendación:** separar `text-muted-decorative` de `text-secondary-ui`,
  subir el rol legible a ≥4.5:1 en cada surface y oscurecer warning text. Añadir
  pruebas automáticas de contraste, no comentarios estimados.
- **Comando sugerido:** `$impeccable audit`.

### [P1] Existen modales paralelos sin el contrato accesible del Modal común

- **Ubicación:** `common/Modal.tsx:32-235` (referencia positiva),
  `users/SectorAssignment.tsx:144-161`,
  `production/CsvExportConfigModal.tsx:35-44,90-118`,
  `onboarding/OnboardingTourModal.tsx:98-145`,
  `showcase/ProjectsPortfolioView.tsx:261-286`,
  `projects/components/ProjectPresentationMode.tsx:463-506`.
- **Categoría:** Accessibility / Components.
- **Evidencia:** `Modal` sí implementa portal, aria-labelledby, focus trap, Esc y
  restore focus. SectorAssignment ni siquiera declara `role="dialog"`, no
  etiqueta el icon-only close y no atrapa/restaura foco. CSV y onboarding
  implementan sólo partes del contrato. Lightbox/presentation son overlays
  especiales sin primitive fullscreen compartido.
- **Impacto:** teclado y lector de pantalla pueden escapar al fondo o perder el
  contexto; el mismo patrón visual se comporta distinto según la feature.
- **WCAG:** 2.1.2 No Keyboard Trap, 2.4.3 Focus Order, 4.1.2 Name/Role/Value.
- **Recomendación:** `Modal`/fullscreen dialog como única infraestructura;
  features sólo aportan contenido. Si presentation mode necesita excepción,
  extraer un `FullscreenDialog` con el mismo contrato.
- **Comando sugerido:** `$impeccable harden`.

### [P1] El escape hatch de tokens permite estilos rotos y hardcodes masivos

- **Ubicación:** `designSystem.test.ts:156-197`,
  `sales/sales.css` (33 literales), `engineering/engineering.css` (15),
  `showcase/projectsPortfolio.css` (13), `projects/projects.css` (12),
  `purchasing/purchasing.css` (11),
  `projects/components/ProjectPhotosGallery.css` (11).
- **Categoría:** Theming / Maintainability.
- **Evidencia:** el test permite cualquier token inexistente si trae fallback.
  Además no escanea `style={{…}}` en TSX. Hay seis referencias sin definición
  ni fallback que pueden producir valor CSS inválido:
  `ProductionOrderLabelsPanel.tsx:865,875,880,890` y
  `Project3DModal.tsx:238,240`.
- **Impacto:** documentación y tokens dejan de ser fuente de verdad; un cambio de
  tema no alcanza las excepciones y algunos estados directamente pierden color.
- **Recomendación:** bloquear nuevos literales UI y tokens inexistentes tanto en
  CSS como TSX. Distinguir colores de datos/material/escena 3D (válidos) de
  chrome de interfaz (siempre token).
- **Comando sugerido:** `$impeccable document`.

### [P1] Formularios y controles no comparten una geometría ni estados completos

- **Ubicación:** `catalogs/catalogs.css:210-250`,
  `purchasing/purchasing.css:400-420,522-548`,
  `projects/components/warranty.css:355-385`,
  `production/csvExportConfigModal.css:73-96`, `common/tabs.css:48-95`.
- **Categoría:** Theming / Accessibility / Anti-pattern.
- **Evidencia:** el form canónico usa `--radius-sm` aunque `design.md` exige
  `--radius-md` para todo control. Purchasing, warranty y CSV crean otros
  paddings, backgrounds, tamaños y focus rings. Tabs no tienen disabled;
  SearchInput no define disabled/error; entity/stat cards interactivas no tienen
  matriz completa.
- **Impacto:** la memoria muscular se rompe y estados no disponibles pueden
  parecer operables. La mezcla Apple × Google falla justo donde M3 debe ganar:
  completitud del estado.
- **Recomendación:** extraer `Field`, `Input`, `Select`, `Textarea`, `Checkbox`,
  `IconButton` y `Tab` con una matriz única default/hover/focus/active/disabled/
  loading/error. No seguir aliasando CSS local indefinidamente.
- **Comando sugerido:** `$impeccable polish`.

### [P1] El target táctil real es 40 px, menor al estándar declarado

- **Ubicación:** `tokens.css:199-212`, `common/buttons.css:152-170`,
  `common/modal.css:134-149`, `common/searchInput.css:42-55`,
  `docs/design.md:420-439`.
- **Categoría:** Accessibility / Responsive.
- **Evidencia:** `--touch-min: 2.5rem` = 40 px. La propia doc exige 44 px y
  referencia 48 dp móvil. Close de modal es 32 px y clear de búsqueda 24 px;
  sólo algunas reglas móviles los elevan indirectamente.
- **Impacto:** más mis-taps en tablet/taller y contradicción con la precisión
  táctil Apple que el documento declara.
- **Recomendación:** 44 px web como mínimo en coarse pointer, 48 dp nativo;
  separar tamaño visual compacto de hit-area con pseudo-elemento o wrapper.
- **Comando sugerido:** `$impeccable adapt`.

### [P1] La organización y su documentación no tienen una IA canónica única

- **Ubicación:** `shell/AppShell.tsx:172-289`, `docs/design.md:440-566` y §6.
- **Categoría:** UX / Organización.
- **Evidencia:** el nav contiene dos labels “Dashboard” (Ventas y Producción),
  contradiciendo la regla de labels únicos de la propia doc y creando resultados
  ambiguos en Cmd+K. El inventario §6 no da specs propias a Dashboard Ventas,
  Dashboard Producción, Ingeniería, Almacén, Agregados o Acabados. En cambio el
  documento declara que el diagnóstico está “resuelto”.
- **Impacto:** navegación y títulos pueden divergir sin que el reviewer tenga una
  spec verificable; el usuario no puede anticipar qué Dashboard abrirá.
- **Recomendación:** definir primero el mapa canónico por rol/JTBD; usar labels
  inequívocos en nav y palette, y una ficha de pantalla para cada destino real.
- **Comando sugerido:** `$impeccable shape`.

## Hallazgos P2 — siguiente pasada

### [P2] Breakpoints fragmentados

- **Evidencia:** aparecen 19 cortes reales (`400`, `480`, `520`, `600`, `639`,
  `640`, `700`, `719`, `720`, `767`, `800`, `840`, `899`, `900`, `1024`,
  `1100` px y tres rem-based), frente a cuatro canónicos.
- **Impacto:** un componente puede cambiar antes que su vecino y producir saltos
  de densidad/overflow difíciles de reproducir.
- **Recomendación:** clasificar cada excepción como container need o eliminarla;
  usar 639/640, 899/900 y 1024 de forma consistente. Container queries sólo
  donde el componente realmente depende de su contenedor.
- **Comando sugerido:** `$impeccable adapt`.

### [P2] Performance de entrada sin separación por ruta

- **Evidencia:** `apps/web/src/App.tsx` importa sincronamente todas las screens
  desde el barrel `@muebles/ui`; sólo escenas/exporters 3D tienen lazy imports.
  El CSS suma 20.413 líneas y los dos dominios mayores superan 4.800.
- **Impacto:** riesgo de bundle inicial y parse CSS excesivos, especialmente en
  equipos de taller modestos. Este es un riesgo estático; falta medir bundle y
  navegación real antes de cuantificarlo.
- **Recomendación:** lazy por destino/ruta, mantener skeleton estable y medir
  chunks/LCP/INP antes y después.
- **Comando sugerido:** `$impeccable optimize`.

### [P2] No existe escala de z-index

- **Evidencia:** 39 declaraciones entre 1 y 9999. Photos y CSV usan 9999;
  modal común 1100, onboarding 1200, command palette 120, toast 200.
- **Impacto:** la jerarquía overlay/modal/toast/tooltip depende del orden de
  feature, no de la arquitectura; aparecen bugs de clipping y overlays tapados.
- **Recomendación:** tokens `--z-sticky`, `--z-dropdown`, `--z-backdrop`,
  `--z-dialog`, `--z-toast`, `--z-tooltip`, `--z-fullscreen`.
- **Comando sugerido:** `$impeccable harden`.

### [P2] Elevación contradice su propia regla

- **Ubicación:** `docs/design.md:247-265`, `common/surfaceCard.css:22-33`,
  `common/entityCard.css:31-62`, `common/statCard.css:8-19`.
- **Evidencia:** la doc dice que L1 elige borde o shadow-sm; los tres primitives
  base usan ambos.
- **Impacto:** cards más “encajonadas” y doc imposible de revisar literalmente.
- **Recomendación:** decidir una sola regla: borde para L1 estático; shadow sólo
  al elevar/interactuar, o documentar la excepción con contraste/evidencia.
- **Comando sugerido:** `$impeccable quieter`.

### [P2] Status vocabularies aún están duplicados

- **Ubicación:** `catalogs/catalogs.css:378-396`, `sales/sales.css:563-581`,
  `common/statusBadge.css:7-102`.
- **Evidencia:** active/inactive/cancelled tienen variantes locales además del
  sistema común. Role/category/revision sí pueden ser metadata distinta, pero no
  deben confundirse con estado.
- **Impacto:** el mismo estado cambia de forma/color según pantalla.
- **Recomendación:** migrar sólo estados equivalentes; dejar metadata bajo un
  `meta-chip` neutral, no crear más “badge” sin taxonomía.
- **Comando sugerido:** `$impeccable distill`.

### [P2] Motion tiene tokens, pero 52 duraciones locales

- **Ubicación:** `sales.css`, `engineering.css`, `projects.css`, galleries,
  warranty, sector assignment y tabs.
- **Impacto:** el producto deja de sentirse como un solo motor táctil.
- **Recomendación:** reemplazar 0.12/0.15/0.2/0.3 s por tokens; conservar
  animaciones de datos/escena sólo si explican estado. El reset global de reduced
  motion es una buena red de seguridad y debe mantenerse.
- **Comando sugerido:** `$impeccable animate`.

### [P2] `docs/design.md` y tokens tienen drift verificable

- **Evidencia:**
  - doc: `--text-muted` 58%; código: 52% (`tokens.css:91`).
  - doc: cards-3 1100 px; token/test: 1024 px.
  - doc §5.1: botones viven en `catalogs.css`; real: `common/buttons.css`.
  - doc dice que HSL “prepara dark mode”, pero no define estrategia ni override.
  - doc omite la mayoría de aliases/roles actuales y repite valores como si fuera
    el archivo fuente.
- **Impacto:** agentes implementan contra dos verdades diferentes.
- **Recomendación:** doc explica intención/contrato y `tokens.css` conserva valores
  ejecutables. Añadir tabla de status “implemented / planned / deprecated”.
- **Comando sugerido:** `$impeccable document`.

### [P2] Dark mode no tiene una decisión de producto

- **Evidencia:** no hay `prefers-color-scheme`, `data-theme` ni selector dark.
- **Impacto:** hoy no es un bug: el uso principal es laptop de taller y un light
  theme legible puede ser la decisión correcta. El problema es prometer
  “preparación” sin decir si habrá dark, high-contrast o sólo light.
- **Recomendación:** decidir por escena física. Priorizar light + contraste alto;
  agregar dark sólo si usuarios trabajan en obra/vehículo con baja luz. La
  arquitectura semántica propuesta permite sumarlo después.
- **Comando sugerido:** `$impeccable shape`.

## Hallazgos P3 — polish

### [P3] Gradiente en stat-card emphasis

- **Ubicación:** `common/statCard.css:113-137`.
- **Impacto:** aislado no daña uso, pero repetido convertiría dashboards en la
  receta genérica de “hero metric”.
- **Recomendación:** conservar como máximo un KPI real por dashboard o sustituir
  por jerarquía tipográfica + borde/área contextual.
- **Comando sugerido:** `$impeccable quieter`.

### [P3] Tipografía literal residual

- **Evidencia:** seis font-size no-token en cinco CSS (login, structures, sales,
  tabs, statusBadge).
- **Impacto:** drift pequeño, pero rompe el gate “0 literales”.
- **Recomendación:** incorporar pasos intermedios sólo si son roles repetibles;
  si no, mapearlos a la escala existente.
- **Comando sugerido:** `$impeccable typeset`.

## Arquitectura propuesta: tema semántico ambiental por área

La solución no es convertir Ventas en una pantalla teal, Ingeniería en una
pantalla violeta y Producción en una pantalla naranja. Eso agotaría al usuario y
confundiría estado con ubicación. La solución es que el área module **capas de
contexto**, con neutralidad dominante.

### 1. Fuente de contexto única

`AppShell` ya conoce `areaId`. Debe proyectarlo al contenedor principal:

```html
<div class="app-layout" data-area="sales|eng|work|neutral">
```

Las features no seleccionan rampas directas. Consumen aliases contextuales.

### 2. Rampas primitivas + roles derivados

```css
/* Primitivas existentes */
--area-sales-100 ... --area-sales-600;
--area-eng-100   ... --area-eng-600;
--area-work-100  ... --area-work-600;

/* Roles contextuales; cambian por [data-area] */
--area-canvas;          /* tinte casi neutro, 1–3% */
--area-surface-soft;    /* headers/toolbar sections, 3–6% */
--area-surface-active;  /* selected/filter active, 8–12% */
--area-border-soft;     /* separación contextual */
--area-icon-bg;
--area-icon-fg;
--area-context-text;    /* siempre ≥4.5:1 */
--area-context-strong;
```

No crear `--sales-button`, `--engineering-card`, etc. El área es contexto, no
componente.

### 3. Penetración por capa

| Capa | Aplicación recomendada | Intensidad |
|---|---|---:|
| Canvas de app | `--area-canvas` | 1–3% |
| Page-header / workspace chrome | `--area-surface-soft` + border soft | 3–6% |
| Icon-chip y section marker | bg/fg de área | 8–15% / tono 500–600 |
| Toolbar/tabs seleccionados | `--area-surface-active` | 8–12% |
| KPI de área | icon-chip y active border | actual, sistematizado |
| Cards/contenido | blanco/neutro por defecto | 0% |
| Primary actions/focus/links | **brand**, no área | sin cambio |
| Success/warning/danger/info | **semánticos**, no área | sin cambio |

Así el color se percibe en toda la pantalla sin “pintar toda la pantalla”.

### 4. Neutral como área real

Overview/Config necesitan `data-area="neutral"`, no ausencia accidental. Eso
evita fallbacks distintos y permite que Inicio sea un puente cross-process.

### 5. Contraste y futuros temas

- Cada rol contextual debe tener pares testeados en card/app/header.
- Dark mode, si se aprueba, redefine roles semánticos; jamás feature CSS.
- Colores de materiales, swatches y escena 3D son datos, no chrome: quedan fuera
  del theme y se documentan como excepción.

## Cambios necesarios en `docs/design.md` (sin implementarlos en esta auditoría)

1. Reescribir §3.2.1 como **tema ambiental por área**, con la tabla de
   penetración anterior; eliminar “nada más” y la prohibición absoluta de
   superficies completas, reemplazándola por límites de intensidad/rol.
2. Declarar `tokens.css` como fuente de valores; la doc conserva decisiones,
   roles, contraste esperado y ejemplos.
3. Añadir una spec de primitives de formulario y matriz completa de estados.
4. Añadir escala de z-index y contrato para fullscreen dialogs.
5. Corregir path de botones, `text-muted`, cards-3 y target 44 px.
6. Documentar light-only como decisión o especificar dark/high-contrast.
7. Completar §6 para cada destino real del nav y cada rol; marcar pantallas
   planned vs implemented.
8. Remover la afirmación “diagnóstico resuelto” hasta que el gate mida 0
   hardcodes de chrome, contraste AA y modal único.
9. Añadir un checklist verificable de área: canvas, header, toolbar, selected,
   icon-chip, con acciones y estados explícitamente fuera del color de área.
10. Añadir tests/gates con herramientas, no texto: contraste, undefined tokens
    CSS+TSX, z-index allowlist y breakpoints permitidos.

## Positivos a preservar

- `docs/PRODUCT.md` define bien usuario, escena, riesgo y register product.
- La regla Apple (deferencia/profundidad) × Google (roles/estados/a11y) es una
  buena división conceptual; necesita bajar a primitives, no más inspiración.
- El shell tiene landmarks, `aria-current`, drawer responsive y Cmd/Ctrl+K.
- `Modal.tsx` es una base accesible y bien probada.
- `.btn` es realmente único y tiene hover/focus/active/disabled.
- La densidad compacta de 14 px body / 12 px labels es adecuada para el taller.
- Data tables ya contemplan scroll, sticky header y números tabulares.
- El reset global respeta `prefers-reduced-motion`.
- Lucide + stroke 1.5 está mayormente estandarizado.
- No existe inflación de radios de 32+ px en cards.
- Los semantic badges principales son comprensibles y la mayoría pasa contraste;
  warning es la excepción crítica.
- Los colores de área actuales separan bien Ventas/Ingeniería/Producción; no hay
  que cambiar su identidad, sino su arquitectura de aplicación.

## Plan de acciones recomendado

1. **[P1] `$impeccable shape`**: aprobar IA, destinos y tema ambiental por área.
2. **[P1] `$impeccable audit`**: corregir y automatizar contrastes AA.
3. **[P1] `$impeccable harden`**: consolidar overlays en Modal/FullscreenDialog.
4. **[P1] `$impeccable document`**: alinear doc/tokens y endurecer gates.
5. **[P1] `$impeccable colorize`**: aplicar aliases de área desde AppShell.
6. **[P1] `$impeccable adapt`**: 44 px web, breakpoints canónicos y smoke.
7. **[P1] `$impeccable distill`**: primitives de forms/status y eliminar familias paralelas.
8. **[P2] `$impeccable optimize`**: lazy por ruta y medición de bundle.
9. **[P2] `$impeccable animate`**: unificar timings y mantener reduced motion.
10. **[P2] `$impeccable quieter`**: resolver borde+sombra y KPI emphasis.
11. **[P1] `$impeccable polish`**: pasada final por pantalla con screenshots.

## Key Learnings:

1. El color de área actual está arquitectado como señal de navegación, no como tema de pantalla; por eso no puede satisfacer la nueva expectativa sin aliases contextuales.
2. `--text-muted` no alcanza WCAG AA sobre las superficies principales pese al comentario de tokens, y warning small text también falla.
3. El Modal común es sólido, pero varios overlays de feature lo evitan y pierden focus trap, restore focus o semántica de diálogo.
4. `docs/design.md` contiene drift verificable frente a tokens, breakpoints, paths y destinos reales del nav.
5. La app tiene buenos primitives base, pero 41 hojas CSS de formularios y 131 colores UI literales muestran que la adopción todavía no está cerrada.

skill_resolution: paths-injected
