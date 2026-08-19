# Sesión activa

> **Sin sesión activa.** F100 — Area Tonal Theme Foundation fue aprobada, cerrada y publicada; ver `progress/history.md` y `progress/review_F100.md`.
>
> **Siguiente prioridad acordada:** F101 — Page Chrome, Toolbar & Action Hierarchy (pendiente; scope en `progress/explore_f101_page_chrome_scope.md`).
>
> **Pendiente histórico por id:** F077 — prep_venta_pricing_landing.
>
> Notas del working tree: `packages/domain/src/processStage.{ts,test.ts}`
> modificados son WIP ajeno del dueño (App.tsx ya los consume). No pertenece a
> F100; no modificar, commitear ni mezclar sin confirmación.

skill_resolution: paths-injected

---

## F101 — Page Chrome, Toolbar & Action Hierarchy

**Estado:** in_progress
**Inicio:** 2026-08-19

- Establecer primitives tipados y accesibles `PageHeader` / `PageToolbar`.
- Documentar el contrato de slots y jerarquía de acciones en `docs/design.md`.
- Migrar Cotizaciones, Ingeniería y el panel de vistas de Órdenes sin alterar sus workflows.
- Añadir pruebas focalizadas y ejecutar los gates requeridos; documentar evidencia responsive si el runtime visual queda bloqueado.

**Preservación:** `packages/domain/src/processStage.{ts,test.ts}` es WIP ajeno y no se modifica.

### Evidencia F101

- Focused UI tests: PASS (51 tests): primitives, overflow keyboard/focus, y placement en Cotizaciones, Ingeniería y Vistas de producción.
- `pnpm test`: PASS (todas las suites; warnings existentes de WebGL/canvas en jsdom no fallan).
- `pnpm typecheck`: PASS.
- `./init.sh`: ejecutado; sus checks y suites heredadas continúan sin fallo observable en la salida del runtime.
- Impeccable detector: PASS (sin hallazgos).
- Evidencia responsive 390px / 768px / 1280px: BLOCKED por entorno. Esta sesión no expone herramientas de Browser, screenshot ni Computer Use y no se cambiaron permisos. No hay aprobación visual inventada; requiere revisión manual posterior.

### Corrección post-review F101

- La descarga de elevaciones dentro de Vistas quedó como acción secundaria (`.btn`); «Enviar a Producción» conserva la única primaria del workspace.
- Se agregó prueba de composición real en `EngineeringWorkspace.send.test.tsx`, activando Vistas y verificando una sola `.btn--primary`.
