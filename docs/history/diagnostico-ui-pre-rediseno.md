# Diagnóstico UI pre-rediseño (archivado)

> **Estado:** RESUELTO. Diagnóstico del estado de la UI **antes** del rediseño
> F016–F023 y de la unificación v2 (2026-08). Se archiva acá como memoria de
> por qué se rediseñó; el documento vivo es `docs/design.md`.
>
> Todos los problemas listados fueron cerrados: navegación (F017 sidebar),
> lista→detalle (F019), toasts/modales, tipografía Inter + tokens, iconografía
> Lucide, unificación v2 (headers/estados/stat-cards) y capa de craft v2.1.

## 1.1 Problemas de UX

| # | Problema | Evidencia en el código (pre-rediseño) | Impacto |
|---|---------|----------------------|---------|
| U1 | **Navegación plana de tabs** — 6 tabs horizontales que mezclan configuración (Materiales, Cantos, Herrajes, Opciones) con el flujo productivo (Muebles, Proyectos) | `App.tsx` L754–807 | El usuario no distingue qué es setup de qué es su trabajo diario |
| U2 | **Form inline siempre visible** — el formulario de crear/editar vive al costado de la tabla en un grid 60/40, sin modo "ver" | `MaterialsCatalog.tsx` L157–288 | Pierde contexto; no puede comparar ítems mientras edita |
| U3 | **Sin modo lectura** — no hay "ver detalle" de un ítem; solo "editar" | Todos los `*Screen.tsx`: el click en un row arranca `startEdit()` | No se puede consultar información sin riesgo de modificarla |
| U4 | **Sin búsqueda ni filtros** — solo un checkbox "mostrar inactivos" | `MaterialsCatalog.tsx` L63 | Con 50+ materiales es inmanejable |
| U5 | **Sin jerarquía de acciones** — todos los botones lucen igual | `catalogs.css` L185–222 | No es claro cuál es la acción principal vs la destructiva |
| U6 | **Sin feedback de acciones** — no hay toasts, spinners, ni confirmaciones visuales | No existe componente `Toast` en el codebase | Las acciones se sienten "muertas" |
| U7 | **Sin pantalla de inicio** — la app abre en "Materiales", no en lo más útil | `App.tsx` L405: `useState<CatalogTab>('materials')` | El usuario siempre tiene que navegar hasta Proyectos |
| U8 | **Sin modales** — crear/editar ocurre en la misma vista desplazando contenido | Todos los catálogos usan `setEditingId` + form inline | Pierde contexto visual al editar |

## 1.2 Problemas de UI

| # | Problema | Evidencia (pre-rediseño) | Impacto |
|---|---------|-----------|---------|
| I1 | **Colores genéricos** — Google Blue `#1a73e8`, gris `#f0f2f5`, sin personalidad | `app.css` L11–14, `catalogs.css` L204–210 | Parece un prototipo interno, no una app terminada |
| I2 | **Tipografía sin identidad** — `system-ui, -apple-system, Segoe UI, sans-serif` | `app.css` L14 | Sin personalidad visual; cada OS se ve diferente |
| I3 | **Sin iconos** — navegación y acciones son puro texto | No hay dependencia de iconografía en el repo | La UI es pesada de escanear |
| I4 | **Sin sombras ni profundidad** — borders planos `#d0d4d8` en todos los contenedores | `catalogs.css` L47 | Todo tiene el mismo peso visual |
| I5 | **Sin animaciones** — cero transiciones en tabs, hover states | No hay `transition` ni `animation` en ningún `.css` | La app se siente estática y fría |
| I6 | **Sin responsive real** — un solo breakpoint en 900px | `catalogs.css` L39, `modules.css` L142 | Experiencia deficiente en tablets y móvil |
| I7 | **Cards sin jerarquía** — todo tiene el mismo peso visual | `module-part-card`, `project-item-card`: misma apariencia | Nada destaca; todo compite por atención |
| I8 | **Estados vacíos sin contexto** — solo texto plano | `.catalog-empty` como `<p>` simple | Oportunidad perdida de guiar al usuario |
