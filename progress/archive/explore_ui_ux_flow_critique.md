# Diagnóstico integral UX / IA — Muebles

> Fecha: 2026-08-18  
> Alcance: app web completa, navegación, flujos, jerarquía de acciones, consistencia, estados y responsive.  
> Método: inventario estructural con CodeGraph primero; revisión de fuente como fallback; detector Impeccable; el navegador real no pudo inspeccionarse por un fallo del runtime del plugin (detalle en Notas de ejecución). No se modificó código ni documentación.

## Veredicto ejecutivo

Muebles ya tiene una base de producto profesional: lenguaje de taller, RBAC real, rutas profundas, `Cmd/Ctrl+K`, estados vacíos útiles, una jerarquía razonable de listas → detalle → editor, y patrones especializados para ventas, ingeniería y fábrica. No parece un prototipo genérico ni un clon de Excel.

El problema principal no es «falta de belleza»: es **fragmentación del modelo mental**. La app expone demasiadas entidades y etapas como destinos paralelos, mientras la identidad visual de cada área termina justo donde empieza el trabajo. Para un administrador aparecen hasta 8 grupos de navegación y 26 destinos posibles; Producción se reparte entre Estado de Planta, Dashboard, Órdenes, Producción, Almacén, Embarques e Instalaciones. El usuario debe aprender la arquitectura interna en vez de seguir la obra.

La mezcla Apple × Google documentada es conceptualmente buena, pero `docs/design.md §3.2.1` impide deliberadamente que el color de área alcance la pantalla: lo limita a sidebar, nav activo e icon-chip. Eso contradice la experiencia solicitada. La solución NO es teñir botones ni cards con colores saturados; es crear una **atmósfera tonal de área** de baja intensidad que abarque canvas, chrome, selección y separadores, preservando brand para acciones y semánticos para estados.

## Design Health Score — Nielsen

| # | Heurística | Score | Evidencia / problema clave |
|---|---|---:|---|
| 1 | Visibilidad del estado | 3/4 | Hay `PageLoading`, `EmptyState`, `ScreenBoundary`, toasts, badges y progreso de planta. Falta una convención uniforme de skeleton/error/retry; `UsersScreen` carga con `try/finally` sin estado de error. |
| 2 | Correspondencia con el mundo real | 4/4 | «Cotizaciones», «Corte», «Encintado», «Embarques», «Instalaciones» y el pipeline por obra hablan el idioma del taller. |
| 3 | Control y libertad | 2/4 | Hay cancelar, volver, filtros limpiables y rutas profundas; no hay undo global ni protección homogénea ante salida con cambios. Varias mutaciones son inmediatas. |
| 4 | Consistencia y estándares | 3/4 | Buenos componentes base y BEM, pero conviven shells propios, `btn`/`btn--secondary`/`btn--ghost`, `btn--small`/`btn--sm`, toasts globales y locales, y headers con estructuras distintas. |
| 5 | Prevención de errores | 3/4 | El dominio bloquea exports inválidos, hay confirmaciones y RBAC. Aún faltan guardas uniformes de dirty state, preview de consecuencia y confirmación contextual en cambios de rol/estado. |
| 6 | Reconocimiento antes que recuerdo | 3/4 | Sidebar con texto, área activa, etiquetas y búsqueda global. El admin debe recordar dónde vive cada etapa entre demasiados destinos y dos «Dashboard». |
| 7 | Flexibilidad y eficiencia | 3/4 | `Cmd/Ctrl+K`, deep links, filtros y acciones batch de fábrica son fortalezas. Falta una gramática global de shortcuts y bulk actions en catálogos/ventas. |
| 8 | Estética y minimalismo | 3/4 | Sistema sobrio y orientado a tarea. La repetición de superficies neutrales/cards diluye la identidad de área y la cantidad de destinos añade ruido cognitivo. |
| 9 | Diagnóstico y recuperación de errores | 2/4 | `ScreenBoundary` ofrece «Reintentar / Ir al inicio», pero varios fetch locales no modelan error recuperable y algunos fallos pueden terminar en vacío o toast genérico. |
| 10 | Ayuda y documentación | 2/4 | Hay primeros pasos y tour desde Ajustes, pero poca ayuda contextual en editores complejos, compras, ingeniería y handoffs. |
| **Total** |  | **28/40** | **Bueno, con deuda estructural prioritaria.** |

El 28/40 no es un premio: significa que la base es sólida, pero la app todavía exige demasiado aprendizaje para sentirse inevitable, tranquila y «perfecta» durante una jornada de 8 horas.

## Fortalezas reales

1. **El dominio está bien traducido a la UI.** `FabricScreen`, `EngineeringScreen`, `PlantBoardScreen` y `PurchasingScreen` usan etapas y acciones reconocibles para el taller.
2. **La arquitectura de navegación permite enlaces reales.** `apps/web/src/routes.ts` define paths canónicos y `AppShell` renderiza anchors, mantiene estado activo y soporta `Cmd/Ctrl+K`.
3. **Las listas principales enseñan qué hacer.** Cotizaciones, clientes, catálogos, ingeniería y producción usan `EmptyState`, búsqueda, filtros y CTAs verbales.
4. **Hay especialización por rol.** `packages/domain/src/rbac.ts::navIdsForRole` reduce la navegación para vendedores, ingeniería, producción y almacén. Esto evita que todos vean todo, aunque el admin todavía sufre sobrecarga.

## Issues priorizados

### [P1] La identidad de área se corta antes del contenido

**Evidencia:** `packages/ui/src/shell/AppShell.tsx:473-475,596` calcula `areaId` y lo aplica al indicador de topbar; `docs/design.md §3.2.1` ordena que el color de área «solo señala ubicación» y «nunca pinta superficies completas». El contenido se monta en `<main className="app-content">` sin contexto tonal de área.

**Impacto:** al cambiar de Ventas a Ingeniería o Producción, el usuario reconoce el área por una etiqueta lateral, no por la pantalla completa. La app se siente como el mismo lienzo neutro con otro título, justo lo que el pedido busca corregir.

**Corrección:** pasar `data-area` al layout/main y documentar tokens tonales por área:

- `--area-canvas`: tinte 1–3% del canvas completo;
- `--area-chrome`: toolbar/tabs sticky 3–6%;
- `--area-border`: separadores y focus contextuales de baja intensidad;
- `--area-selected`: fila/tab seleccionada 6–10%;
- `--area-ink`: texto/icono de ubicación con contraste AA.

Brand sigue ganando en CTA primary y foco global; success/warning/danger siguen siendo estados. «Toda la pantalla» debe significar **atmósfera consistente**, no cards saturadas ni botones de tres colores.

**Comando sugerido:** `$impeccable colorize` + `$impeccable document`.

### [P1] La IA expone el organigrama del sistema, no el viaje de la obra

**Evidencia:** `packages/ui/src/shell/AppShell.tsx:164-279` define 8 grupos (TRABAJO, VENTAS, PRODUCCIÓN, INGENIERÍA, COMPRAS/ALMACÉN, LIBRERÍA, CATÁLOGOS, CONFIG) y 26 `AppNavId`. Para admin, Producción/operaciones se fragmenta en Estado de Planta, Dashboard, Órdenes, Producción, Almacén, Embarques e Instalaciones.

**Impacto:** Alex aprende rápido, pero incluso él pierde tiempo decidiendo qué vista responde «¿dónde está esta obra?» y cuál permite actuar. Jordan no puede inferir la diferencia entre Órdenes, Producción y Estado de Planta sin probarlas.

**Corrección:** adoptar un modelo de dos niveles:

1. nivel primario por trabajo: **Inicio · Ventas · Ingeniería · Operaciones · Biblioteca** (Config en perfil/administración);
2. subnavegación contextual dentro del área, con una landing por área y «recientes / pendientes / bloqueos»;
3. la **obra** como hilo conductor transversal: cotización → ingeniería → almacén → fabricación → embarque → instalación, con timeline y CTA de próxima acción según rol.

El RBAC actual se conserva; sólo cambia la presentación. Admin ve áreas, no 26 herramientas al mismo nivel.

**Comando sugerido:** `$impeccable shape` + `$impeccable distill`.

### [P1] Producción tiene demasiadas fuentes de verdad

**Evidencia:** `AppShell.tsx` declara `productionDashboard`, `orders`, `production`, `plantBoard`, `warehouse`, `shipments`, `installations`. El propio comentario de `orders` dice que es **TEMPORARY** y será removido tras migrar tabs. `docs/roadmap-screens/00-overview.md` ya anticipa consolidación.

**Impacto:** los handoffs se vuelven navegación: un gerente abre Dashboard, luego Órdenes; un operario usa Producción; ventas usa Estado de Planta; logística usa Almacén/Embarques. El sistema es correcto pero la transición de responsabilidad no está contenida en una vista de obra.

**Corrección:** cerrar M2 con una decisión firme:

- **Overview de operaciones** = estado y excepciones;
- **Obra operativa** = timeline, readiness, documentos y responsables;
- **Estación** = cola de ejecución del operario;
- **Almacén/Embarques/Instalaciones** = lentes operativos del mismo estado de obra, no hubs paralelos con datos duplicados;
- eliminar `Órdenes` cuando sus tabs migren; no mantener compatibilidad visual indefinida.

**Comando sugerido:** `$impeccable shape`.

### [P1] `design.md` ya no coincide con las rutas ni con la IA actual

**Evidencia:** `apps/web/src/routes.ts:10-35` usa `/production`, `/plant-board`, `/shipments`, `/installations` y ubica Embarques bajo COMPRAS/ALMACÉN en `AppShell.tsx`. `docs/design.md §6.7a–d` todavía documenta `/fabrica`, `/planta`, `/embarques`, `/instalaciones` y en partes sitúa Embarques en PRODUCCIÓN.

**Impacto:** implementadores y revisores pueden «corregir» la UI hacia una arquitectura vieja. Una fuente de verdad desactualizada es peor que no tener documentación.

**Corrección:** actualizar §4 y §6 desde `NAV_PATHS`/`APP_NAV_SECTIONS`; añadir tabla `navId → path → área → roles → acción primaria → patrón`; marcar aliases legacy explícitamente, no mezclarlos con paths canónicos.

**Comando sugerido:** `$impeccable document`.

### [P1] El esqueleto visual y la jerarquía de acciones no son universales

**Evidencia:** listas de catálogos usan `catalog-page`; Dashboard usa `dashboard__header`; Ingeniería usa `eng-landing__header`; Producción usa `fabric__header`; `UsersScreen.tsx:140-171` usa `catalog-layout` + `catalog-page__header` y un toast local. Hay variantes de botón `btn`, `btn--secondary`, `btn--ghost`, `btn--small` y `btn--sm` (`ProjectsPortfolioView.tsx`).

**Impacto:** cada equipo puede producir una pantalla correcta de forma aislada pero la memoria muscular no se transfiere. El usuario vuelve a evaluar dónde están los filtros, el CTA y el estado en cada pantalla.

**Corrección:** convertir el «esqueleto único» de `design.md §4.1a` en componentes obligatorios (`PageScaffold`, `PageHeader`, `PageToolbar`, `WorkspaceChrome`, `ActionGroup`) y eliminar aliases visuales. Una sola primaria por nivel, orden estable: primaria → secundaria → overflow.

**Comando sugerido:** `$impeccable layout` + `$impeccable polish`.

### [P2] Error, loading y feedback tienen cobertura pero no contrato único

**Evidencia:** existen `ScreenBoundary`, `PageLoading`, `InlineLoading`, `EmptyState` y toast global. Sin embargo, `UsersScreen.tsx:81-90` no captura error de fetch y no expone retry; `UsersScreen` mantiene un toast propio; `design.md §8` pide skeleton, pero muchas pantallas usan loading central.

**Impacto:** con red lenta o API caída, Sam/Jordan no siempre saben si esperar, reintentar o volver. Dos sistemas de toast producen duración, posición y anuncio distintos.

**Corrección:** contrato de pantalla `idle/loading/success/empty/no-results/error/stale`; skeleton que conserva estructura; error inline con retry y último dato; todas las mutaciones en toast global + estado local accesible (`aria-live`).

**Comando sugerido:** `$impeccable harden`.

### [P2] Los formularios complejos necesitan graduación modal → drawer → ruta

**Evidencia:** CRUD breve de clientes/catálogos usa modal correctamente; módulos/estructuras/componentes ya usan editor full-page. En cambio, `PurchaseOrdersPanel.tsx` reúne proveedor, múltiples líneas, emisión y recepción dentro de overlays/formularios extensos.

**Impacto:** una orden de compra o recepción larga no es una interrupción pequeña. En modal se comprime contexto, dificulta comparar stock/proveedor y aumenta riesgo de pérdida por cierre.

**Corrección:** documentar umbral: modal ≤4 campos/una decisión; drawer para inspección/edición breve con contexto; ruta/workspace para entidades con líneas, tabs, preview o guardado progresivo. Añadir dirty-state guard y borrador.

**Comando sugerido:** `$impeccable shape` + `$impeccable harden`.

### [P2] Responsive existe, pero «usable» no equivale a ergonómico

**Evidencia:** `appShell.css` colapsa sidebar a 899px y usa `--touch-min`; muchas pantallas tienen breakpoints y scroll horizontal. `production.css` fuerza tablas de al menos 480px en móvil; varios controles pequeños/icon-only no prueban 44×44 en todo el sistema. Las primarias viven normalmente en headers superiores.

**Impacto:** Sam con zoom 200% y Casey con una mano encuentran acciones fuera de zona de pulgar, tablas que requieren paneo y controles compactos. Para escritorio/taller esto es P2, no P1; la app móvil nativa debe resolver el trabajo de campo.

**Corrección:** 390/768/1280 como contrato; touch ≥44px en táctil; toolbar sticky inferior sólo para flujos móviles críticos; tablas → cards/column priority; no trasladar editores 3D completos al móvil.

**Comando sugerido:** `$impeccable adapt` + `$impeccable audit`.

### [P3] Dos «Dashboard» y varios nombres necesitan contexto

**Evidencia:** `APP_NAV_SECTIONS` contiene Dashboard de Ventas y Dashboard de Producción con el mismo label «Dashboard»; Command Palette los agrupa a ambos como «Navegación» y usa el label sin prefijo (`AppShell.tsx:423-437`).

**Impacto:** resultados ambiguos en búsqueda y conversaciones de soporte («abrí Dashboard»).

**Corrección:** labels completos en paleta y breadcrumbs: «Dashboard de ventas», «Dashboard de producción»; el sidebar puede mantener «Dashboard» sólo cuando el encabezado de área está visualmente unido.

**Comando sugerido:** `$impeccable clarify`.

## Matriz pantalla → acción primaria / secundaria

| Área / pantalla | Acción primaria correcta | Secundarias / overflow | Diagnóstico |
|---|---|---|---|
| Login | Iniciar sesión | Acceder sin conexión; Solicitar acceso | Bien priorizado; el modo invitado debe explicar límites antes de entrar. |
| Registro | Solicitar acceso | Volver a iniciar sesión | Bien: resultado «pendiente de aprobación» claro. |
| Inicio | Próxima acción según rol; normalmente Nueva cotización | Vitrina / Nuevo mueble / accesos de rol | Buena personalización; evitar tres CTAs equivalentes cuando no hay onboarding. |
| Dashboard de ventas | Abrir/continuar la oportunidad prioritaria | Filtros, cancelar, cambiar owner | Le falta CTA inequívoco «Nueva cotización» en el nivel dashboard para ventas. |
| Cotizaciones — lista | Nueva cotización | Desde plantilla; Plantillas; filtros | Buena jerarquía. «Plantillas» debe ir a overflow/gestión secundaria. |
| Cotización — detalle/editor | Guardar cambios o avanzar estado | Presentar, duplicar, export comercial, historial, eliminar | Demasiadas capacidades: agrupar por trabajo (Editar / Presentar / Entregar / Más), no por formato de export. |
| Clientes | Nuevo cliente | Buscar; editar; ver cotización; desactivar | Correcto; «Ver cotización» dentro de expand debe mostrar nombre/estado para no navegar a ciegas. |
| Vitrina | Usar en cotización (sólo en detalle) | Buscar, filtrar, usar proyecto como referencia | El patrón browse-only → detalle es fuerte. |
| Ingeniería — cola | Iniciar / Abrir proyecto por card | Buscar; filtrar por status | Buena primaria contextual; stat cards como filtros deben anunciar estado pressed. |
| Ingeniería — workspace | Enviar a Producción cuando readiness pasa | Marcar documentado; exports del tab; volver | Correcto si «Enviar» sólo aparece habilitado al final; exports deben vivir en Documentos, no chrome. |
| Estado de Planta | Abrir obra (destino según rol) | Filtros futuros; explicación de avance | Debe seguir read-only. Link adaptado por rol es una fortaleza. |
| Dashboard de producción | Resolver cuello de botella / abrir obra | Actualizar; métricas; filtro sector | Definir una primaria basada en excepción; «Actualizar» nunca debe competir visualmente. |
| Órdenes — cola | Abrir orden | Pack / marcar en producción si corresponde | Bien por card, pero pantalla temporal: no invertir más IA permanente. |
| Orden — hub | Siguiente paso de la obra | Tabs Resumen/Piso/Etiquetas/Herrajes/Documentos | Una sola primaria entre chrome y tab. Completar migración y retirar hub redundante. |
| Producción — estaciones | Empezar/terminar estación o avance batch | Cola/Métricas; cambiar estación | Excelente orientación operativa. Asegurar confirmación de batch con conteo/consecuencia. |
| Almacén — picking | Liberar materiales / marcar surtido según rol | Tabs Stock/Compras; búsqueda | Hoy concentra tres trabajos. La landing debe mostrar pendientes y conducir, no exponer todos los tabs sin prioridad. |
| Compras / órdenes de compra | Nueva orden de compra | Proveedores; emitir; cancelar; recibir | Crear/recibir son flujos complejos: ruta o workspace, no modal grande. |
| Embarques — lista/detalle | Abrir control / Liberar a reparto | Ver contenido; volver | La lista sólo «Ver» es correcta; el detalle debe mostrar readiness antes de liberar. |
| Instalaciones | Marcar instalado | Contacto/dirección; incidencias | Correcta acción one-tap; datos del cliente son requisito del trabajo, no metadata secundaria. |
| Muebles | Nuevo mueble / Guardar en editor | Categorías; duplicar; desactivar/eliminar | Lista→detalle→editor correcta. Categorías debe ser gestión secundaria. |
| Estructuras | Nueva estructura / Guardar | Duplicar; activar/desactivar; eliminar | Patrón consistente con Componentes; conservar 3D contextual. |
| Agregados | Nuevo agregado / Guardar | Eliminar; administrar piezas/herrajes | Nombre técnico requiere microcopy inicial para Jordan. |
| Componentes | Nuevo componente / Guardar | activar/desactivar; editar roles/cantos | Buen full-page editor; dirty-state y resumen de errores al cambiar tab son obligatorios. |
| Grupos de opciones | Nuevo grupo / Guardar | Editar; eliminar; buscar | Correcto como entidad transversal; preview de impacto antes de borrar. |
| Materiales | Nuevo material | Editar; desactivar; imagen; buscar | Buen patrón catálogo; acciones por fila deben converger en un menú a densidad alta. |
| Cantos | Nuevo canto | Editar; desactivar; buscar | Igual que Materiales; mantener misma anatomía exacta. |
| Herrajes | Nuevo herraje | Editar; desactivar; imagen; buscar | Igual que Materiales; no crear variantes visuales por catálogo. |
| Acabados | Nuevo acabado | Categorías; editar; desactivar; filtros | Tiene demasiadas acciones de administración en toolbar; mover categorías a secundaria. |
| Ajustes | Guardar cambios | Ver tour de bienvenida | Guardar sticky o feedback de cambios no guardados; tour no debe ser la única ayuda. |
| Usuarios | Aprobar usuario | asignar rol/sectores; rechazar; recargar | Cambio de rol inmediato necesita feedback/rollback; icon-only «sectores» requiere `aria-label`. El botón Settings deshabilitado añade ruido y debe eliminarse. |

## Organización objetivo por trabajos y roles

### Ventas

- Landing: pipeline, clientes a contactar, cotizaciones bloqueadas, próximos pasos.
- Secundarias: Cotizaciones, Clientes, Vitrina.
- CTA global: Nueva cotización.
- No mostrar bibliotecas técnicas salvo búsqueda contextual desde la cotización.

### Ingeniería

- Landing: obras aceptadas por readiness/urgencia.
- Obra: Resumen → Diseño → Despiece → Documentos → Entrega a Producción.
- Biblioteca y Catálogos como herramientas laterales/contextuales, no siete destinos top-level.
- CTA global contextual: Iniciar / Resolver bloqueo / Enviar a Producción.

### Producción

- Operador: una landing de «Mi estación» con trabajo reclamable y batch.
- Gerente: overview de excepciones/cuellos + acceso a obra.
- Instalación: lista móvil-first con dirección, contacto, checklist e incidencia.
- «Estado de Planta» es una vista transversal de lectura, accesible desde la obra y desde Inicio.

### Taller / admin

- Inicio ejecutivo con excepciones de las cuatro áreas.
- Switcher o áreas primarias, no todos los módulos simultáneamente.
- Config/Usuarios bajo menú de cuenta/Administración.
- Command palette conserva acceso rápido a cualquier entidad y recientes.

## Modales vs rutas

**Mantener modal:** crear/editar cliente, material, canto, herraje, grupo simple, confirmaciones destructivas, detalle comercial breve de Vitrina.

**Usar drawer o panel lateral:** inspección rápida de entidad desde tabla, filtros avanzados, preview de stock o cliente sin abandonar la obra.

**Usar ruta/workspace:** cotización, proyecto de ingeniería, orden de compra con líneas, recepción, mueble/estructura/componente, producción por obra, editores 3D. Regla: si hay tabs, múltiples líneas, preview, borrador o más de una decisión, no es modal.

## Estados y feedback

Cada pantalla debe declarar en documentación y tests:

1. `loading`: skeleton de la estructura real;
2. `empty`: explica por qué está vacío y la acción inicial;
3. `no-results`: conserva filtros visibles y ofrece limpiar;
4. `error`: qué falló + retry + navegación segura;
5. `stale/offline`: último dato y timestamp humano;
6. mutación en progreso: deshabilita sólo el alcance afectado;
7. éxito: toast global con sujeto + verbo;
8. error de mutación: inline junto al origen y trabajo preservado.

## Responsive, touch y teclado

- El escritorio 1280px sigue siendo el contexto principal de cotización/ingeniería.
- 768px debe permitir supervisión y almacén sin perder acciones.
- 390px debe priorizar planta, embarques, instalaciones, estado y consulta; no fingir que el editor 3D completo es buen móvil.
- Targets ≥44×44 en modalidad táctil, aunque la densidad visual siga compacta.
- Tabs con roving tabindex ya son un buen patrón; extenderlo a todos los tablists.
- `Cmd/Ctrl+K` debe mostrar shortcuts y disambiguar áreas.
- Toda modal/drawer: foco inicial intencional, trap, Escape, retorno del foco.
- Sticky bottom action bar sólo en móvil para tareas one-tap de producción/instalación; no globalmente.

## Personas — recorridos y banderas rojas

### Alex — power user

- **Recorrido:** abrir obra reciente → revisar readiness → producir/exportar.
- **Funciona:** Cmd+K, deep links, recientes, batch en fábrica.
- **Red flags:** dos Dashboards indistinguibles en paleta; demasiados destinos de producción; falta bulk consistente en catálogos/ventas; algunas acciones secundarias están siempre visibles en toolbar.

### Sam — teclado, lector de pantalla y zoom

- **Recorrido:** filtrar cola → abrir proyecto → completar acción sin mouse.
- **Funciona:** botones semánticos, `aria-label` frecuente, tablists con roles, `ScreenBoundary`.
- **Red flags:** icon-only con `title` pero sin `aria-label` en Usuarios; tablas con scroll horizontal y sticky cells al 200%; toasts locales/globales con anuncios potencialmente distintos; stat cards deben exponer pressed/selected.

### Jordan — primera vez

- **Recorrido:** crear la primera cotización y entender cómo llega a fábrica.
- **Funciona:** primeros pasos, empty states y lenguaje de taller.
- **Red flags:** no hay mapa visible de la obra completa; «Agregados», «Grupos», «Órdenes» y «Producción» requieren conocimiento previo; el tour vive en Ajustes, lejos del momento de duda.

### Vendedor del taller

- Necesita cotizar, recuperar cliente, usar Vitrina y responder «¿dónde está mi obra?».
- Red flags: Estado de Planta separado del detalle de cotización; puede perder contexto al saltar de ventas a progreso; no necesita ver nombres técnicos de ingeniería.

### Ingeniero

- Necesita una cola por readiness, acceder a biblioteca/catálogos sin abandonar la obra y entregar documentación completa.
- Red flags: Biblioteca y Catálogos son demasiados destinos laterales; el handoff debe ser checklist, no memoria; exports duplicados entre chrome/tab crean duda.

### Operario / instalación

- Necesita una próxima acción física, grande, inequívoca y con contexto de obra.
- Red flags: web desktop-first, controles compactos, acciones arriba, tablas horizontales; dirección/contacto en Instalaciones es crítico, no pendiente cosmético.

## Cambios necesarios en `docs/design.md`

1. **Reescribir §3.2.1**: permitir color de área en canvas/chrome/selección con rampas de baja intensidad y presupuesto de color; mantener brand en acciones y semánticos en estados.
2. **Agregar «gramática de acciones»**: una primaria por nivel; orden; overflow; reglas para card/lista/workspace; disabled vs ocultar.
3. **Reemplazar IA vieja de §6** con tabla generada/verificada contra `APP_NAV_SECTIONS` y `NAV_PATHS`.
4. **Documentar landing por área y timeline de obra**, no sólo pantallas por entidad.
5. **Agregar decisión modal/drawer/ruta** con umbrales explícitos.
6. **Convertir estados de pantalla en contrato**, no checklist opcional.
7. **Añadir matrix responsive por capacidad**: qué tareas son desktop, tablet y mobile; touch ≥44px.
8. **Añadir DoD de coherencia visual**: screenshot de 3 áreas juntas, no revisión de una pantalla aislada.
9. **Corregir paths y ubicación de Embarques**; documentar aliases legacy por separado.

## Orden recomendado de trabajo

1. **IA y consolidación de Operaciones** (P1): decidir mapa objetivo y retiro de Órdenes temporal.
2. **Sistema tonal por área** (P1): actualizar design doc + shell + page scaffold, sin recolorear CTAs.
3. **Esqueleto y acciones** (P1): componentes universales de header/toolbar/workspace.
4. **Rutas/documentación** (P1): alinear `design.md` con el código actual.
5. **Estados y formularios complejos** (P2): error/retry/drafts + orden de compra fuera de modal.
6. **Responsive/a11y** (P2): 390/768/1280, touch y teclado.
7. **Polish screen-by-screen** (P3): tipografía, densidad, microinteracciones, copy.

## Detector y anti-patterns

- Detector Impeccable: `node .agents/skills/impeccable/scripts/detect.mjs --json packages/ui/src apps/web/src` → **0 hallazgos**.
- No se detectó slop determinístico (gradiente de texto, eyebrows repetitivas, glassmorphism por defecto, etc.).
- Esto NO valida jerarquía, IA ni pixel craft: el detector sólo descarta familias de anti-patrones conocidas.
- Veredicto AI slop: **no parece AI genérico**, pero la repetición de shells/cards neutrales puede sentirse «sistema armado por partes» en vez de producto único.

## Notas de ejecución

- CodeGraph: usado primero; inventarió rutas, `AppShell`, RBAC, screens y call paths.
- Fallback filesystem: usado después de CodeGraph para completar labels, acciones y CSS responsive que el resultado capado no incluía.
- Navegador: servidor Vite iniciado correctamente en `http://127.0.0.1:5173/`; la conexión del plugin Browser falló antes de crear tab con: `Trusted RPC dependency must resolve within a configured trusted code path: .../browser-service.mjs`.
- Inspección visual real / overlay: no disponible; no se afirma evidencia pixel-perfect ni overlay visible.
- Assessment independence: secuencial; esta subtarea no lanzó subagentes adicionales.
- Snapshot `.impeccable/critique`: omitido por contrato de la tarea; el único artefacto solicitado es este archivo.
- Score: respaldado por estructura/código y debe revalidarse visualmente cuando el Browser funcione.

## Apéndice A — Intento de evidencia visual con Chrome

> Estado: **BLOQUEADO por el runtime de control de Chrome; no se agrega evidencia visual inventada.**

### Preparación verificada

- Se leyó el skill obligatorio `chrome:control-chrome` antes del intento.
- Vite arrancó correctamente con `pnpm --filter @muebles/web dev --host 127.0.0.1`.
- URL disponible: `http://127.0.0.1:5173/`.
- Chrome fue solicitado por su selector explícito (`agent.browsers.get("chrome")`), sin sustituirlo por Browser, Playwright standalone ni Computer Use.

### Bloqueo exacto

La inicialización del cliente oficial de Chrome falló antes de poder obtener una pestaña o leer la documentación operativa del browser:

```text
Trusted RPC dependency must resolve within a configured trusted code path: file:///Users/tiagofur/.codex/plugins/cache/openai-bundled/browser/26.814.41407/scripts/browser-service.mjs
```

El error ocurre al importar:

```text
/Users/tiagofur/.codex/plugins/cache/openai-bundled/chrome/26.814.41407/scripts/browser-client.mjs
```

Ese cliente deriva internamente a una dependencia del plugin Browser que el runtime no reconoce como trusted path. La falla sucede **antes** de crear `agent`, seleccionar Chrome, abrir una tab o navegar a localhost; por eso tampoco existe una instancia válida desde la cual pedir `chrome-troubleshooting`.

### Matriz de evidencia solicitada

| Evidencia | 390px | 768px | 1280px | Resultado |
|---|---:|---:|---:|---|
| Layout/sidebar/topbar | No ejecutada | No ejecutada | No ejecutada | Bloqueada antes de abrir tab |
| Jerarquía y color por área | No ejecutada | No ejecutada | No ejecutada | Sin screenshot ni DOM computado |
| Acciones/cards/forms/tablas | No ejecutada | No ejecutada | No ejecutada | Sin interacción real |
| Foco/teclado/modal | No ejecutada | No ejecutada | No ejecutada | Sin sesión de Chrome |
| Contraste visual/computed styles | No ejecutada | No ejecutada | No ejecutada | Sin acceso a estilos computados |

### Consecuencia para este diagnóstico

- Los hallazgos estructurales, de IA y de documentación del informe principal siguen respaldados por CodeGraph y fuente.
- El score 28/40 continúa siendo **provisional en lo visual**.
- No se afirma que 390/768/1280 estén aprobados ni fallidos.
- No se afirma que contraste, foco visible, modales, toolbars sticky o color de área hayan sido observados en pantalla.
- La revalidación debe repetirse cuando el runtime permita cargar el cliente oficial de Chrome; en esa corrida hay que capturar al menos Inicio, Cotizaciones, Ingeniería, Producción, Almacén y un editor/formulario en los tres viewports.
- El servidor Vite temporal fue detenido después del intento.

## Apéndice B — Último fallback visual con Computer Use

> Estado: **BLOQUEADO por permisos macOS; no se inventa evidencia de Inicio, Ventas, Ingeniería ni Producción.**

### Preparación verificada

- Se leyó el skill obligatorio `computer-use:computer-use` antes de operar la UI.
- Se usó exclusivamente el runtime oficial `@oai/sky` mediante Node REPL para las acciones de Computer Use.
- Vite arrancó correctamente y expuso la app en `http://127.0.0.1:5173/`.
- El primer target solicitado fue Google Chrome por bundle id `com.google.Chrome`, con captura completa del estado de accesibilidad y pantalla.

### Bloqueo exacto

El primer intento quedó esperando la autorización del sistema y devolvió:

```text
Computer Use permissions are still pending. The user has not finished granting Accessibility and Screen Recording permissions in the ChatGPT Computer Use window. Call this tool again, as the user is almost done finishing granting permissions. Do not end your turn yet, just call this tool again.
```

Se reintentó una vez, tal como indicó el runtime. El resultado definitivo fue:

```text
Computer Use permissions are not granted
```

La falta simultánea de **Accessibility** y **Screen Recording** impidió obtener el árbol AX, screenshot, estado de Chrome o cualquier control de ventana. La falla ocurrió antes de navegar a localhost; no hubo clicks, escritura, resize ni interacción con la app.

### Superficies y viewports solicitados

| Superficie | 1280px | Ancho compacto | Evidencia obtenida |
|---|---:|---:|---|
| Inicio | No ejecutada | No ejecutada | Ninguna; permisos denegados antes de abrir/navegar Chrome |
| Ventas / Cotizaciones | No ejecutada | No ejecutada | Ninguna |
| Ingeniería | No ejecutada | No ejecutada | Ninguna |
| Producción | No ejecutada | No ejecutada | Ninguna |

### Qué sigue sin estar visualmente validado

- continuidad del color de área entre sidebar, topbar, canvas y superficies;
- jerarquía real de CTA primaria/secundarias;
- densidad, alineación y legibilidad de cards, formularios y tablas;
- contraste computado y foco visible;
- comportamiento de modales, tabs sticky y scroll;
- colapso del sidebar y reflow en ancho compacto;
- target size y ergonomía táctil.

### Condición para reintentar

Conceder a la app de ChatGPT/Codex los permisos macOS **Accessibility** y **Screen Recording**, reiniciar la app si macOS lo exige y repetir esta matriz. Hasta entonces, el informe conserva evidencia estructural verificable, pero el score 28/40 no debe presentarse como validación pixel-perfect.

- No se generaron screenshots.
- No se abrió una ventana controlable.
- No se alteró estado de la app ni del navegador.
- El servidor Vite temporal fue detenido después del intento.

## Key Learnings:

1. La app ya implementa una fusión Apple × Material coherente en principios, pero la regla actual de color de área impide que esa identidad llegue al contenido.
2. El principal problema UX es la fragmentación del ciclo de vida de la obra entre demasiados destinos, especialmente en Producción.
3. `docs/design.md` conserva rutas y ubicación de pantallas que ya no coinciden con `NAV_PATHS` y `APP_NAV_SECTIONS`.
4. La mejora correcta no es saturar toda la pantalla: es extender el color de área como atmósfera tonal de baja intensidad, manteniendo colores de acción y estado separados.

skill_resolution: paths-injected
