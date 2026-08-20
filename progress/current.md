# Sesión activa

**Feature:** F121 — shell_render_split
**Estado:** Done
**Fecha:** 2026-08-20

## Objetivo

Split del render del shell: App.tsx < 1500 L con el render aislado y tipado.

## Qué se hizo

1. **`ShellView.tsx` (1817 L)**: TODO el render (AppShell + 26 branches navId + modal guest-import + onboarding) extraído de App.tsx. Recibe un ctx de 228 campos **completamente tipado** — la interfaz `ShellViewCtx` se generó con la Compiler API de TypeScript a partir del tipo inferido del literal real (sin tipos manuales, sin any). Pipeline determinista: extracción del JSX → scanner de identificadores libres (strings/comments/attrs filtrados) → intersección con definidos en AppContent → generación.
2. **`AppContent.tsx` (~1990 L)**: la orquestación completa (wiring de stores, effects, handlers, wrappers, derivaciones, construcción del ctx).
3. **`App.tsx` → 49 L**: raíz de composición pura (SessionGate + ToastViewport + AppContent + resets de sesión F118).
4. Tests grep repuntados a los módulos nuevos (App.test, designSystemShell).
5. `OwnerPortfolioRow` exportado del barrel de ui (lo necesitaba la interfaz del ctx).

## Incidente de la sesión

Trabajo concurrente de otra sesión (split de production screens) apareció a mitad de F121 y pisó mis cambios no commiteados; se detuvo, se limpió, el usuario lo resolvió (commit `73e949d`), y F121 se re-ejecutó desde cero sobre árbol estable con pipeline mejorado (determinista, sin loops frágiles).

## Resultados de Verificación

- `pnpm test`: domain 660 · storage 125 · excel 72 · ui 1124 · web 285 · mobile 36 · desktop 17 — **todos verdes**.
- `pnpm typecheck`: 0 errores. `./init.sh`: 100% verde.

## Trayectoria del shell

App.tsx: **4101 → 3622 (F119) → 2795 (F120) → 49 (F121)**. El ciclo del Judgment Day del Shell queda completo: F118 (bugs) + F119/F120/F121 (slimming).

## Próximos pasos

Siguientes JD sugeridos: Cotizaciones/Proyectos, Producción, Proyectar 3D. Split interno opcional de ShellView por áreas si algún área vuelve a crecer.
