# Sesión

**Feature en curso:** F150 — ui_card_click_open (#auditoría paridad UI)
**Inicio:** 2026-08-23

## Contexto

Auditoría de paridad UI pantalla por pantalla (excluye 3D) en
`progress/ui-parity-audit-2026-08-23.md`. El dueño decidió unificar el patrón
de entrada a detalle: **click en la card abre** (como Ingeniería/Cotizaciones),
sin botón "Abrir X" dedicado, en Órdenes (cola), Instalaciones y Embarques.

## Plan

- Patrón stretched link: el título de la card es el control real (foco, Enter,
  aria-label); hit-area cubre toda la card; acciones internas (Pack, tel:)
  quedan por encima y no burbujean.
- Hover affordance con state layer del sistema + cursor pointer.
- design.md: regla universal §4.2 + specs §6.7/§6.7c/§6.7d.
- Tests de comportamiento (teclado + mouse + no-apertura desde acciones).

## Verificación

- (pendiente) pnpm test + typecheck.
- (pendiente) visual con sesión auth — el dueño proveerá credenciales.

## Hallazgos previos de la auditoría (no parte de F150)

- Bug routing /modules: deep link/F5 rebota a lista (causa:
  useModulesScreenState.ts:343 corre antes de hidratar). Candidato F151.
- Tablas de catálogo: sin affordance de expansión + acciones hover-only.
- Estructuras: Desactivar/Eliminar visibles sin overflow "Más".
