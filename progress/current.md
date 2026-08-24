# Sesión

**Features cerradas:** F154 — table_expand_chevron_affordance · F155 — structures_overflow_destructive_actions · F156 — catalog_image_placeholder_a11y
**Inicio:** 2026-08-24 · **Cierre:** 2026-08-24
**Reviews:** `progress/review_F154.md`, `progress/review_F155.md`, `progress/review_F156.md` (APPROVED)
**Rama:** `feat/f154-row-expand-affordance` (pusheada — las tres features viajan en el PR #359 por decisión del dueño, con commits y reviews separados)

## F154 — Resultado

Hallazgo P1 #1: chevron de affordance en tablas expandibles (`CatalogTable` →
Materiales, Cantos, Herrajes, Acabados, Grupos, Clientes). Derecha en reposo,
rota 90° al expandir, muted→secondary en hover, aria-hidden + aria-expanded.

## F155 — Resultado

Hallazgo P2 #4: Estructuras agrupa Desactivar/Eliminar en overflow "Más"
(paridad con Muebles, §4.1a.2). Fix colateral dataTestId del Modal de delete.

## F156 — Resultado

Hallazgo P3 #5: el placeholder de `CatalogImage` era `role="img"` con
`aria-label` = nombre de la entidad — duplicaba el título en el announcement
del lector y el texto "Sin foto" filtraba al nombre accesible. Fix:
placeholder 100% decorativo (`aria-hidden`, sin role ni aria-label); la
imagen real conserva su alt.

**Verificación colateral — hallazgo P2 #3 (headings múltiples en Librería)
ya resuelto en main sin código nuevo:** medido en navegador (guest, seed):
Muebles 1 h2 + 18 h3 · Estructuras 1 h2 + 14 h3 · Componentes 1 h2 + 24 h3 ·
Agregados 1 h2 + 1 h3 — exactamente un h2 (título de pantalla) por pantalla,
cards en h3 (§4.1b). La auditoría lo midió el 2026-08-23 antes de los fixes
posteriores; se registra como verificado.

## Verificación (evidencia)

- `pnpm test` 3.055 verdes (ui 1.408: 7 F154 + 4 F155 + 3 F156 nuevos);
  `pnpm typecheck` 0 errores.
- F156 visual (guest, seed, tras reload): nombre accesible de la card
  "MOD-GAB-01 Gabinete 1 Puerta 300 x 720 x 590 mm 2 componentes 5 herrajes
  Costo estimado $842.90 MXN" — sin "Sin foto" y sin duplicación del nombre
  (antes: el nombre entraba dos veces); placeholder sin role=img.

## Siguientes pasos (backlog auditoría)

1. Continuar revisión: catálogos (resto), Clientes, Vitrina (con datos).
2. Auth-only: Órdenes, Producción (estaciones), Embarques, Instalaciones,
   Almacén, dashboards por rol, Usuarios.
3. Responsive (390/768) y foco visible por pantalla (cobertura pendiente del
   audit).
