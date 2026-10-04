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
- [ ] K1 → PR
- [ ] K2 → PR (apilado)
- [ ] K3 → PR (apilado)
- [ ] K4 → PR (apilado)
- [ ] K5 → PR (apilado)
- [ ] Browser proof + re-critique
