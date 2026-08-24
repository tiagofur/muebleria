# Sesión

**Feature cerrada:** F150 — ui_card_click_open (auditoría de paridad UI)
**Inicio:** 2026-08-23 · **Cierre:** 2026-08-23
**Review:** `progress/review_F150.md` (APPROVED)

## Resultado

Unificación del patrón de entrada a detalle: **la card abre con click en su
cuerpo** (como Ingeniería/Cotizaciones) en cola de Órdenes, Instalaciones y
Embarques. Botones "Abrir orden" / "Abrir instalación" / "Ver detalle"
eliminados. El título de la card es el control real (`card-open`,
`common/cardOpen.css`): foco visible, Enter/Espacio, `aria-label` de acción;
hit-area estirada cubre toda la card (`::after` inset 0); botones de proceso
(Pack) y links `tel:` quedan por encima (`var(--z-base)`) y no abren. Hover
alineado al lenguaje de `entity-card` (borde brand + `--shadow-md` +
`--surface-hover`). `design.md` §4.2 universaliza la regla; §6.7/§6.7c/§6.7d
actualizadas.

## Verificación (evidencia)

- `pnpm test` completo verde (suite ui 1385 + web 306 + resto; typecheck 0).
- Tests de comportamiento nuevos: apertura por teclado y mouse en los 3
  componentes; Pack y `tel:` no disparan apertura; sin botón dedicado.
- Guard del design system (tokens/z-index) verde.
- **Visual con sesión auth del dueño** (tiagofur@gmail.com):
  - Órdenes: sin "Abrir orden"; Pack primaria visible; click en cuerpo
    interceptado por `button.card-open` (actionability de Playwright = proof
    del stretched); trigger navega al hub `/orders/:id`; back regresa; hover
    de card con borde brand + sombra + título brand + cursor pointer
    (capturas `/tmp/muebles-review/20-21`).
  - Instalaciones: sin "Abrir instalación"; trigger navega a
    `/installations/:id`; cuerpo interceptado (captura 22).
  - Embarques: sin "Ver detalle"; trigger navega a `/shipments/:id`
    ("Control de Carga y Despacho de Flete"); cuerpo interceptado (captura 23).

## Siguientes pasos (backlog de la auditoría)

1. Bug routing `/modules/:id` deep-link/F5 rebota a lista (causa:
   `useModulesScreenState.ts:343`) — candidato F151.
2. Chevrón/affordance de expansión en tablas de catálogo + acciones de fila
   visibles sin hover.
3. Estructuras: Desactivar/Eliminar al overflow "Más" (paridad con Muebles).
4. Continuar revisión pantalla por pantalla: Estructuras, Componentes,
   catálogos, Clientes, Vitrina (con datos), Config; luego auth-only restantes.
