# ODD — #1032 Paridad UX del grupo CATÁLOGOS

- **Lane:** Delegated Direct (5 pantallas × 5 slices; recovery valioso).
- **Writer:** GLM (ZCode), sesión 2026-10-04. Un escritor, rama aislada por slice.
- **Base:** `origin/main` @ 4d17697b (incluye #1009 y #1019 mergeados).
  Aprobación: owner en sesión — top 5 completo en orden, Duplicar en las 5
  (vía draft, reutilizando el camino de creación), issue madre #1032.

## Outcome

Las 5 pantallas de catálogo (Materiales, Cantos, Herrajes, Perfiles, Acabados)
firman los patrones de la familia: contrato de guardado (K1), confirmación de
Desactivar + Duplicar (K2), clases CSS reales (K3), identidad en modals +
internos fuera de pantalla (K4), higiene de datos (K5).

## Decisiones de alcance

- Duplicar es **vía draft**: abre el modal de creación prefillado (código
  `-COPY` sugerido, nombre «(copia)») reutilizando el camino de creación
  existente — sin store actions ni deep-copies de dominio nuevas.
- Eliminar queda fuera (el retiro es Desactivar).
- Referencia interna del contrato de guardado: `HardwareCatalog.tsx:157-182`
  (Herrajes y Perfiles ya lo cumplen).

## Checks / evidencia

- Vitest packages/ui (+ apps/web si toca store), typecheck workspace.
- Browser proof de las 5 rutas al cierre + re-corrida `$impeccable critique`
  (baseline 19/40). Overlay sin cramped-padding/line-length nuevos (K5).
- PRs apilados con label type:* desde el inicio.

## Task log

- [x] Issue #1032 fileada; preflight OK; rama K1 desde origin/main.
- [x] K1 → PR #1033 (`feat/1032-catalogos-ux-k1`). Las 3 pantallas a
  contrato async + store actions devolviendo el settle (materials/edges/
  ambient dejaban de tragar rechazos; createEdge → Promise<string> con el
  quick-create esperándolo). ui 2108/2108 (6 tests diferidos), web 581/581.
- [x] K2 → PR #1034 (`feat/1032-catalogos-ux-k2`). Desactivar pide
  ConfirmDialog (código+nombre+consecuencia) y Duplicar vía draft prefillado
  (`suggestDuplicateCode` + «(copia)») en las 5. 2 tests de desactivación
  actualizados al contrato nuevo. 124/124 catalogs.
- [x] K3 → PR #1035 (`feat/1032-catalogos-ux-k3`). 13 usos `.badge*` →
  `status-badge--*` (5 variantes genéricas nuevas), botones muertos →
  `btn--small`. Grep de muertas en catalogs/: 0.
- [x] K4 → PR #1038 (`feat/1032-catalogos-ux-k4`). Los 5 modals con
  identidad guardada en el título; IDs/SHA en disclosure «Datos técnicos»;
  «Forma genérica: bar-pull» traducido con los labels del formulario;
  voseo unificado en el subsistema 3D.
- [x] K5 → PR #1039 (`feat/1032-catalogos-ux-k5`). `CatalogColumn.numeric`
  → `catalog-table__num` alineado derecha (8 columnas), hint CSS duplicado
  consolidado con `max-width: 72ch`. cramped-padding documentado como falso
  positivo (densidad diseñada); CTAs dobles son patrón de familia.
- [x] Browser proof (rama K5 servida por vite local, modo invitado):
  Materiales — cifras alineadas a derecha en screenshot; Desactivar abre el
  ConfirmDialog «¿Seguro que querés desactivar "TAB-ARA-BLA — ARAUCO
  BLANCO"?…» (K2 ✓); Duplicar abre el modal de creación con
  `TAB-ARA-BLA-COPY` + `ARAUCO BLANCO (copia)` (K2 ✓); Herrajes — fila con
  Editar·Duplicar·Desactivar, «Forma genérica: Bisagra» traducido (K4 ✓),
  costo unit. tabular derecho (K5 ✓). El badge de validación 3D requiere un
  herraje con asset vinculado (el seed invitado no tiene) — la evidencia de
  K3 es el mapeo completo a status-badge + el grep en 0. Restante post-merge:
  re-corrida `$impeccable critique` sobre main (baseline 19/40).
