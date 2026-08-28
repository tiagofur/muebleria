# F103 — Alcance: sincronización documental integral UI/UX

## Resultado buscado

Convertir `docs/` en una fuente de verdad **operable y honesta** para el estándar
UI/UX post F100–F102. Los agentes futuros deben poder distinguir qué está
implementado, qué es una regla vigente, qué sigue planificado y qué referencia
histórica no deben copiar.

F103 es exclusivamente documental: no modifica UI, rutas, RBAC, tokens ni
flujos. Cuando el código y un documento discrepan, el documento se corrige
contra la fuente ejecutable; no se inventa una migración ya realizada.

## Evidencia y autoridad

| Necesidad | Fuente de verdad durante F103 | Uso documental |
|---|---|---|
| Paths y destinos de sidebar | `apps/web/src/routes.ts` → `NAV_PATHS` | Tabla canónica `navId → label → path → estado`; no volver a escribir rutas a mano como autoridad. |
| Acceso por sesión/rol | `roleCanAccessNav` y guards de rutas | El doc puede describir el propósito/rol, pero enlaza al guard ejecutable para la matriz efectiva. |
| Shell/área y primitives entregados | `packages/ui/src/shell/`, `packages/ui/src/common/` y tests | Marcar F100–F102 como **implemented** y enlazar componente/token real. |
| Intención y contratos UX | `docs/design.md` | Norma humana: qué patrón elegir, QA y decisiones de producto. |
| Flujo/ownership de Producción | `docs/production-module.md` + `docs/roadmap-screens/` | Producto y roadmap; paths se derivan de `NAV_PATHS`. |
| Límites de capas | `docs/architecture.md` | Mantener “UI presenta, dominio calcula”; documentar que las reglas UX no autorizan lógica de dominio en React. |

### Estados obligatorios

Toda tabla de navegación, primitive y patrón que pueda confundirse con código
actual usa uno de estos estados visibles:

- **implemented** — existe en código y tiene evidencia/ruta/componente verificable.
- **planned** — contrato o intención aprobada, todavía no está entregada; no se
  presenta como comportamiento actual.
- **deprecated** — alias, ruta, patrón o nombre histórico; no usarlo para
  enlaces, código nuevo ni nuevas pantallas. Debe apuntar al reemplazo.

No se emplean “parcial” o “en curso” sin decir qué parte concreta falta y cuál
es la fuente ejecutable actual.

## Cambios documentales incluidos

### 1. Navegación y rutas: una matriz canónica

Actualizar `docs/design.md` y `docs/production-module.md` para que sus nombres,
`navId`s y paths coincidan con `NAV_PATHS`:

| Destino | navId | Path vigente |
|---|---|---|
| Estado de Planta | `plantBoard` | `/plant-board` |
| Producción (estaciones) | `production` | `/production` |
| Órdenes (hub por obra) | `orders` | `/orders` |
| Embarques | `shipments` | `/shipments` |
| Instalaciones | `installations` | `/installations` |
| Dashboard Producción | `productionDashboard` | `/production-dashboard` |
| Almacén | `warehouse` | `/warehouse` |

La tabla final debe cubrir todos los destinos de `NAV_PATHS`, sus labels de UI,
la sección y el estado. Cualquier valor histórico como `/fabrica`, `/planta`,
`/embarques`, `/instalaciones`, `fabric`, `projects`, `purchasing`,
`ambientMaterials`, `agregados` o `production` usado como alias de Órdenes se
marca **deprecated**, con el reemplazo verificable. No se conserva un alias
como si fuera una ruta soportada sin confirmarlo en código.

La decisión de IA pendiente — consolidar o retirar Órdenes en M2 — continúa
**planned**. F103 describe ownership actual de cada pantalla y remite a la
spec/roadmap; no reorganiza la app por documentación.

### 2. Contrato de formularios y controles — planned

Añadir a `docs/design.md` una anatomía única para `Field`, Input, Select,
Textarea, Checkbox/Switch y number/date controls:

- label persistente, control, unidad/sufijo cuando aplique, hint y error;
- label no se reemplaza por placeholder; placeholder legible ≥4.5:1;
- matriz default/hover/focus-visible/pressed/disabled/read-only/loading/error;
- `aria-describedby`, required/error y foco de primer error al fallar guardado;
- agrupación por decisión del usuario, selección/autocomplete antes que texto
  libre cuando el catálogo lo permite;
- grid de hasta dos columnas para campos cortos relacionados en expanded y una
  columna en compact.

Se etiqueta **planned** hasta que exista primitive único, migración de los CSS
locales y cobertura. El documento no afirma que los 41 estilos locales estén
consolidados.

### 3. Contrato de modal, fullscreen dialog, drawer y panes — planned

Completar una matriz de elección y accesibilidad:

| Patrón | Elegibilidad | Regla de accesibilidad |
|---|---|---|
| Modal | decisión breve / edición acotada | primitive `Modal`, portal, `role=dialog`, label, trap, Esc y retorno de foco |
| Fullscreen dialog | presentación/lightbox o contenido que excede dialog normal | mismo contrato de modal; no overlay manual |
| Drawer / inspector | inspección o edición contextual sin perder comparación | foco/escape/restore según modalidad; no clipping por contenedor |
| Supporting pane | lectura/edición compleja en expanded | preferirlo antes que encadenar modales |
| Ruta/workspace | tabs, subítems, borrador o trabajo prolongado | guardar/descartar y guard de cambios antes de salida |

El `Modal` ya entregado se identifica **implemented**. `FullscreenDialog`,
Drawer/Inspector común y la migración de overlays paralelos quedan
**planned**; no se declara consolidación antes de implementarla.

### 4. Accesibilidad, targets y color con estado honesto

Actualizar `docs/PRODUCT.md` y `docs/design.md` con:

- AA verificable: body, texto de UI, placeholders, hints y texto semántico
  normal ≥4.5:1; controles/bordes/indicadores no textuales ≥3:1; color nunca
  es el único portador de significado;
- separación conceptual de texto decorativo y texto UI legible;
- baseline de hit-area **44×44 CSS px** para touch/controles compactos, aun
  cuando el ícono o control visual sea menor;
- estado actual: el token efectivo sigue en **40px**, por lo que la migración y
  auditoría de componentes son **planned**, no una afirmación de cumplimiento;
- F100 (roles de área, canvas/chrome y pares AA de área) y F102 (tabs ARIA)
  permanecen **implemented**, sin extender esa afirmación a warning, login ni
  todos los placeholders hasta que haya pruebas por par.

### 5. Estados de pantalla y mutación — planned

Establecer contrato para `loading`, `empty`, `no-results`, `error`, `stale`,
`success` y mutación en curso:

- carga inicial con skeleton o `PageLoading`, sin layout shift;
- empty/no-results explican siguiente paso; error identifica objeto/acción y
  ofrece retry cuando es seguro; mantener último dato si es verificablemente
  usable y marcarlo stale;
- éxito corto cerca del objeto + toast `aria-live`; validación recuperable junto
  al campo, no sólo toast;
- acciones largas declaran progreso, cancelación/continuación si existe y estado
  final; no se falsifica éxito optimista;
- cada pantalla debe declarar qué estados soporta. La cobertura uniforme de
  todas las pantallas se marca **planned**.

### 6. Capas, movimiento y layout adaptativo

Documentar la norma sin afirmar migración de CSS todavía:

- escala semántica `--z-base`, `--z-sticky`, `--z-dropdown`,
  `--z-modal-backdrop`, `--z-modal`, `--z-toast`, `--z-tooltip`; valores
  locales/`9999` se consideran deuda **planned**;
- motion sólo tokenizado, 150–250ms para controles cuando aplique, sin bounce;
  `prefers-reduced-motion` conserva feedback sin desplazamiento; excepciones
  requieren razón y QA;
- estructura compact / medium / expanded para navegación, lista-detalle,
  supporting pane, formularios y acciones; evitar “desktop encogido”; hover no
  es la única vía;
- breakpoints vigentes se señalan como tokens/valores ejecutables y los nuevos
  cortes exigen justificación. La reconciliación de los cortes locales sigue
  **planned**;
- layout adaptativo debe validar 390px, 768px y 1280px sin overflow, labels
  truncados ni pérdida de foco.

### 7. Higiene, mantenimiento y límites

- `docs/design.md` termina con una tabla de primitives/patrones con su estado,
  fuente ejecutable, owner y QA.
- La política de tokens prohíbe literales visuales en feature CSS/TSX excepto
  valores de datos visualizados o renderizado especializado documentado; las
  excepciones deben llevar razón, token no aplicable y revisión. La automatización
  que cubra CSS y estilos inline queda **planned**.
- `docs/architecture.md` conserva la frontera: estos contratos ordenan la
  presentación; cálculos, validaciones de negocio y transiciones permanecen en
  dominio/backend.
- Documentos de exploración bajo `progress/explore_ui_*.md` pasan a ser
  evidencia histórica; no sustituyen la guía vigente.

## Fuera de alcance

- Cambios a rutas, `NAV_PATHS`, RBAC, AppShell, componentes, CSS/tokens o tests.
- Reorganización de IA, consolidación de Órdenes o retiro de pantallas.
- Migración de formularios, overlays, warnings, targets, z-index, motion,
  breakpoints o headers locales.
- Declarar dark mode, increased contrast o lazy routing como entregados.
- Tocar el WIP ajeno `packages/domain/src/processStage.{ts,test.ts}`.

## Acceptance criteria para F103

1. `docs/design.md`, `docs/PRODUCT.md`, `docs/production-module.md` y
   `docs/architecture.md` distinguen explícitamente fuentes ejecutables de
   intención/roadmap; `apps/web/src/routes.ts`/`NAV_PATHS` es la autoridad de
   paths y el documento lo enlaza.
2. Una matriz única de navegación cubre todos los `AppNavId` de `NAV_PATHS` con
   label UI, sección, path vigente y estado `implemented|planned|deprecated`;
   no quedan rutas activas documentadas que contradigan el código.
3. Los aliases históricos están aislados como `deprecated` con reemplazo, sin
   mezclarse con destinos vigentes. La consolidación futura de Órdenes se
   describe como `planned`, no como una retirada realizada.
4. `docs/design.md` contiene contratos observables para formulario/control,
   Modal/FullscreenDialog/Drawer/Supporting pane, estados de pantalla/mutación,
   AA/placeholder, target de 44px, z-index, motion y layouts compact/medium/
   expanded; cada contrato identifica su estado real.
5. F100, F101 y F102 se reflejan como `implemented` con sus componentes/tokens
   y límites reales; los hallazgos no entregados (contraste global, target
   efectivo 40px, overlays paralelos, z-index, adopción masiva) quedan
   `planned` y no se maquillan como cerrados.
6. La guía conserva color de área como contexto tonal y CTA/focus/semánticos
   globales; no introduce una skin Apple/Google ni permite lógica de dominio en
   UI.
7. La documentación usa enlaces/rutas reales y estructura escaneable; enlaces a
   `progress/explore_ui_*.md` se declaran evidencia histórica, no fuente de
   ejecución.
8. Se actualizan `progress/current.md` y `feature_list.json`; el cambio no
   modifica archivos de aplicación, dominio, backend, rutas ni WIP ajeno.
9. Validación documental: JSON válido, links internos/rutas citadas contrastados
   con `NAV_PATHS`, búsqueda de aliases obsoletos revisada y diff limitado a
   documentación/backlog/progress.

## Verificación propuesta

```bash
node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8')); console.log('feature_list.json OK')"
rg -n '/fabrica|/planta|/embarques|/instalaciones|nav `fabric`|nav `production`' docs/ 
# Revisar cada resultado: vigente, deprecated explícito o corrección necesaria.
git diff --check
git diff --name-only
```

La feature no requiere `pnpm test` para probar una edición Markdown; si se toca
código por accidente, se detiene y se separa del alcance documental.
