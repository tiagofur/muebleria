# Auditoría de paridad UI — sesión 2026-08-23

> Revisión pantalla por pantalla (excluye editor 3D/Proyectar). Fuente de verdad:
> `docs/design.md` (§4.1a esqueleto, §4.1b título único, §4.2 lista→detalle,
> §4.2.1 patrón por entidad, §9.1 matriz de navegación).
> Entorno: dev server :5174, sesión guest, seed demo. Editor 3D fuera de alcance.

## Ledger transversal — entrada a detalle (evidencia DOM + visual)

| Pantalla | Entrada al detalle | URL | Back | Acciones del chrome | h2 en pantalla |
|---|---|---|---|---|---|
| Cotizaciones | click en card (toda la card es button) | `/quotes/:id` (vista completa) | "Lista" (aria "Volver a la lista") | 1 lifecycle por estado + secundarias + **Más** ✅ | 1 ✅ |
| Clientes | click en fila → expande inline | `/customers/:id` (misma lista) | n/a (no cambia pantalla) | Editar/Desactivar **sólo visibles al hover** ❌ | 1 ✅ |
| Materiales | click en fila → expande inline | `/materials/:id` | n/a | ídem ❌ | 1 ✅ |
| Cantos / Herrajes / Acabados / Grupos | click en fila → expande inline | `/:section/:id` | n/a | ídem ❌ | — |
| Muebles | click en card → vista detalle | `/modules/:id` (**deep link/F5 roto** ❌) | "Lista" | Vista 3D · Editar · **Más** ✅ | lista: 19 ❌ · detalle: 7 ❌ |
| Estructuras | click en card → vista detalle | `/structures/:id` | "Lista" | Vista 3D · Editar · **Desactivar · Eliminar visibles** ❌ (sin overflow) | lista: 16 ❌ · detalle: 4 ❌ |
| Componentes | click en card → vista detalle | `/components/:id` | "Lista" (presunto) | — (falta revisar) | lista: 25 ❌ |
| Agregados | (vacío en seed) | — | — | — | 2 (empty como h2) ❌ menor |
| Vitrina | (vacío en seed; spec: modal LG) | — | — | — | — |
| Estado de Planta | tabla read-only | — | — | — | 1 ✅ |
| Ajustes | form | — | — | — | 1 ✅ |

## Revisión Pantalla 1 — Cotizaciones (lista + detalle)

Cumple en general su spec §6.2:

- ✅ Esqueleto §4.1a: PageHeader (título + Más acciones + Nueva cotización),
  toolbar con búsqueda y chips de estado por defecto [Todos].
- ✅ Regla de oro §4.2: click en card → **ver** (read-only si el estado lo exige).
- ✅ Chrome de detalle: back "Lista", título h2, badge estado, etapa operativa,
  meta densa, precio de venta.
- ✅ Una acción primaria de ciclo de vida por estado: borrador → "Enviar al
  cliente"; aceptado → "Marcar en producción" (guest sin workspace de fábrica,
  según spec).
- ✅ Más ▾ agrupado: Comercial (xlsx/PDFs) + Cotización (Presentar, Duplicar,
  Plantilla, Reabrir, Eliminar). Escape cierra el menú.
- ✅ En aceptado los ítems quedan readonly y la salida a edición es
  "Reabrir a borrador…" (correcto por lifecycle, no es bug).

Hallazgos propios:

- [P2] **Tour de Bienvenida modal bloqueante** en el primer acceso (global, no
  sólo Cotizaciones). `design.md` §4.9 lo prohíbe ("tours forzados, popups de
  onboarding bloqueantes"). Es salteable ("Omitir") y sólo primera vez, pero el
  doc es categórico. Decidir: eliminar o cambiar por ayuda contextual opt-in
  (y actualizar el doc si se decide mantenerlo).
- [P3] Meta del chrome: "Cliente Demo·10 muebles·MXN·Margen ×1.35" — separador
  `·` sin espacios; resta legibilidad vs §7.2.

## Hallazgos transversales de paridad

1. **[P1] Doble patrón de entrada sin affordance.** Catálogos/Clientes expanden
   la fila inline (la URL cambia a `/:id` pero la pantalla sigue siendo la
   lista); Librería navega a una vista de detalle completa. §4.2.1 sanciona la
   diferencia por complejidad de entidad, PERO hoy **no hay ningún indicador
   visual** de que la fila expande (sin chevron, sin "Ver"): el usuario no
   puede predecir qué hará el click. Sugerencia: chevron animado en la primera
   celda de las tablas expandibles + cursor/hover de fila consistente con cards.
2. **[P1] Acciones de fila ocultas hasta hover** (Editar/Desactivar en
   Clientes/Materiales/Cantos/Herrajes/Acabados/Grupos). Playwright confirma
   click bloqueado ("covered by td") y la captura las muestra ausentes en
   reposo. Indescubribles para el usuario nuevo e inutilizables en touch
   (§4.0 targets 44px). Sugerencia: acciones visibles en la celda de acciones
   (icon-only con aria-label ya las tienen) o menú de fila "⋯".
3. **[P2] Jerarquía de headings rota en LIBRERÍA** (§4.1b: h2 = sólo el título
   de pantalla). Muebles lista: 19 h2 (17 cards + "Filtrar"); Estructuras
   lista: 16; Componentes: 25; detalles de mueble/estructura: 4–7 (secciones
   como "Costo y venta", "Componentes (2)" en h2). Cotizaciones, Estado de
   Planta y Ajustes sí cumplen. Fix: card title → h3; secciones de detalle → h3.
4. **[P2] Gramática de acciones inconsistente en la misma familia.** Detalle de
   Muebles usa overflow "Más" para destructivas ✅; detalle de Estructuras
   muestra Desactivar + Eliminar en el chrome ❌ (§4.1a.2: destructivas →
   overflow). Unificar con EngineeringDetailLayout.
5. **[P3] "Sin foto" contamina el nombre accesible** de las cards de Muebles
   ("Sin foto | MOD-GAB-01 | Gabinete…" en el announcement del lector de
   pantalla). El placeholder visual no debería entrar al nombre accesible.
6. **[P3] Headings de empty states** ("Sin agregados", "No hay fotos en el
   portafolio") como h2, compitiendo con el título de pantalla.

## Revisión Pantalla 2 — Muebles (lista + detalle + editor)

Cumple:

- ✅ Búsqueda con estado "Sin resultados" + "Limpiar filtros" que restaura
  defaults (§4.5 exacto).
- ✅ Detalle: chrome Lista · Vista 3D · Editar · **Más** (Duplicar/Eliminar en
  overflow — gramática §4.1a correcta, a diferencia de Estructuras).
- ✅ Layout maestro-detalle: lista (~30%) + panel detalle (~70%), preview de
  costo con opciones default, herrajes, presets.
- ✅ Editor full-page: tabs (General · Estructura · Componentes · Agregados ·
  Medidas · Herrajes), Guardar/Cancelar/Volver, **guard de cambios** con
  diálogo "Descartar cambios" (Seguir editando / Descartar y salir) — §9.3.

Hallazgos:

- **[P1] Routing/hidratación de /modules roto (3 síntomas, 1 causa):**
  1. carga completa de `/modules/:id` **rebota a la lista** (deep link y F5
     pierden el detalle);
  2. "Descartar y salir" del editor vuelve a la vista detalle pero **deja la
     URL en `/edit`**;
  3. recargar `/modules/:id/edit` **renderiza el detalle** (no el editor).
  Causa raíz: `useModulesScreenState.ts:343` — el efecto de selección corre
  antes de hidratar el workspace (`modules` vacío) y sale sin seleccionar; el
  sync selección→URL reescribe a `/modules`. `/quotes/:id` y
  `/structures/:id` no lo padecen (render directo por ruta).
- [P2] h2 múltiples (19 en lista: cards + "Filtrar"; 7 en detalle: secciones
  "Costo y venta", "Componentes (2)"…). §4.1b: un h2 por pantalla.
- [P3] "Sin foto" contamina el nombre accesible de las cards.
- [P3] Doc drift: §6.3 describe tabs "General…Costo"; el editor real tiene
  "Agregados" y el costo vive como panel (no tab). Actualizar design.md.

## Cobertura pendiente

- Auth-only (requieren backend/sesión): Órdenes (cola + hub), Producción
  (estaciones), Embarques, Instalaciones, Almacén, dashboards por rol, Usuarios.
- Vitrina y Agregados: revisar con datos (vacíos en seed guest).
- Editors full-page de Muebles/Estructuras/Componentes (`/:id/edit`).
- Responsive (390/768) y foco visible por pantalla.

## Orden propuesto (siguientes)

2. Muebles detalle + editor full-page
3. Estructuras (detalle + fix candidatas de acciones)
4. Componentes
5. Materiales como referencia de la familia tabla-expand (+ affordance)
6. Clientes · 7. Vitrina (con datos) · 8. Ajustes/Usuarios (auth)
