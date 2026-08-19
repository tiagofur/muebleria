# Sesión activa

> **Sin sesión activa.** Las últimas sesiones (design v3.0, mejoras /orders,
> limpieza de documentación integral, 2026-08-18) están cerradas y pushed —
> ver `progress/history.md`. Artefactos cerrados: `progress/archive/`.
>
> **Próximo pendiente por id:** F077 — prep_venta_pricing_landing.
>
> **Prioridad temporal explícita:** por instrucción del usuario, F100 — Area Tonal Theme Foundation reemplaza temporalmente a F077 como la próxima feature a implementar. F077 conserva estado `pending`; este cambio no altera su prioridad histórica.
>
> Notas del working tree: `packages/domain/src/processStage.{ts,test.ts}`
> modificados son WIP ajeno del dueño (App.tsx ya los consume). No pertenece a F100; no modificar, commitear ni mezclar sin confirmación.


---

## Feature en curso

**F100 — Area Tonal Theme Foundation**
**Inicio:** 2026-08-19

Plan:
- Reemplazar el contrato restrictivo de color de área por un contexto tonal verificable.
- Definir tokens semánticos por área y preservar roles brand/focus/semánticos globales.
- Propagar el contexto Sales / Engineering / Production / neutral en el frame compartido.
- Cubrir resolución, propagación y pares de contraste con pruebas enfocadas.

Evidencia de implementación:
- `docs/design.md` §3.2.1 reemplazado por el contrato de contexto tonal y matriz de superficies.
- `tokens.css` define roles completos por Sales, Engineering, Production y neutral; contraste mínimo verificado: 5.87:1.
- `AppShell` resuelve y propaga `data-area-context` al canvas y chrome sin cambiar CTAs, focus ni estados semánticos.
- Prueba enfocada verde: `pnpm --filter @muebles/ui exec vitest run src/shell/appShell.test.ts` (18 tests).
- `pnpm typecheck` verde.

skill_resolution: paths-injected

Correcciones de revisión F100:
- `appShell.test.ts` ahora renderiza AppShell en jsdom para Sales, Engineering, Production y neutral; `apps/web/src/areaThemeShell.test.ts` enlaza rutas reales del web shell con ese frame.
- La prueba calcula y enumera los 16 ratios ink/superficie; todos cumplen AA (mínimo 5.87:1). `docs/design.md` apunta al archivo real.
- Pendiente de esta pasada: gates completos y commit/push atómico solicitado por revisión.

skill_resolution: paths-injected

Verificación final y entrega:
- `pnpm test` verde.
- `pnpm typecheck` verde.
- `./init.sh` verde.
- Commit F100 atómico creado: `feat(ui): add area tonal theme foundation`.
- Push completado a `origin/main`; F100 queda `in_progress` hasta nueva aprobación.

skill_resolution: paths-injected
