# Implement F112 — Área Library (Catálogos + Librería) en oliva/sage

**Fecha:** 2026-08-19 · **Feature:** `library_area_context` · **Decisión del dueño:**
de 3 propuestas (oliva/ciruela/violeta) eligió **oliva/sage hue 95**.

## Qué se hizo

- **Taxonomía**: nuevo contexto de área `library` para LIBRERÍA + CATÁLOGOS
  (creación/mantenimiento del sistema), separado de `eng` (Ingeniería) y `work`.
  `AppAreaId` = `sales | eng | library | work`; `SECTION_AREA` remapea
  `libreria`/`catalogos`.
- **Tokens** (`design-system/tokens.css`): rampa primitiva oliva
  (`--area-library-100..600`, hue 95) + roles tonales
  canvas/chrome/container/border/selected/ink/states bajo
  `[data-area-context='library']`, mismo contrato que F100. Comentario de
  verificación AA actualizado (library ≥6.59:1).
- **Shell** (`appShell.css`): sección sidebar `--library` (label -300, activo
  con borde -400 + mix 28%, icono -300) y topbar `data-area='library'` (-600).
- **Features que usaban eng en pantallas library**: placeholder sin foto de
  cards de Muebles (`modules.css`) pasa a la rampa library; nueva variante
  `.stat-card--library` en `statCard.css`.
- **Tests**: `appShell.test.ts` — casos de contexto (`engineering→eng`,
  `modules/materials→library`) y 4 pares AA nuevos (canvas 7.61, chrome 7.21,
  container 6.59, selected 6.85; suite pasa de 16 a 20 pares).
  `apps/web/areaThemeShell.test.ts` — integración de rutas
  (`/materials`, `/modules` → library).
- **Docs**: `docs/design.md` §3.2.1 — tabla de contextos con `library`
  (oliva/sage, propósito), QA y conteo de pares actualizados.

## Verificación

- UI: 1008/1008 · web integration: área correcta · `pnpm typecheck` verde ·
  `./init.sh` verde completo · detector Impeccable 0 hallazgos.
- Smoke visual (IAB, invitado): `/materials` y `/modules` resuelven
  `data-area-context="library"` con canvas oliva `rgb(247,250,245)` y chip
  `rgb(225,236,218)`; análisis visual confirma tinte oliva perceptible en
  canvas/chip/sidebar (CATÁLOGOS) con registro sobrio. Ingeniería sigue
  cubierta por test de unidad (`engineering→eng`); invitado no accede a esa
  ruta en vivo.

## Fuera de scope

- Calibración de intensidad de todos los canvas (F107).
- Dark/increased-contrast (feature dedicada, §3.2.1).
- WIP ajeno `processStage.{ts,test.ts}` no tocado.
