# Review — feature F106

**Veredicto:** APPROVED

## Checkpoints

- C1: [x] `./init.sh` exit 0 (corrida final tras el último cambio)
- C2: [x] Una sola `in_progress` (F106 al cerrar); UI 1020/1020; `current.md` al día
- C3: [x] Presentación pura en `packages/ui`; sin dominio; tokens-only (detector 0)
- C4: [x] Suite domain verde dentro de init.sh; sin export/storage
- C5: [x] Cierre atómico: feature done + history + current en plantilla; WIP ajeno excluido

## Diseño UI/UX (docs/design.md §8)

- D1: [x] Primitivos compartidos; CSS muerto podado con verificación de uso TSX por selector (alias groups de pageHeader.css quedaron sólo con `.prod-queue__*` vivo — excepción hub §4.1a)
- D2: [x] §4.1a: headers con icon-chip del mapa §3.7/§6; sin primarias nuevas (screens de operativa/lectura); stats/contexto en `contextualControls`, no acciones
- D3: [x] Ajustes/Usuarios: badge de pendientes al subtítulo (no compite con acciones); modales/toasts intactos; `data-testid` preservados
- D4: [x] A11y: «Recargar usuarios», «Asignar sectores de {usuario}» y el disabled de rol con `aria-label` (§4.8 icon-only SIEMPRE)
- D5: [x] Sin animaciones nuevas; reduced-motion intacto
- D6: [x] Responsive: `/settings` verificado 1280/390 sin overflow; pantallas admin/producción cubiertas por tests (guest redirige — evidencia in vivo bloqueada por RBAC, declarada)
- D7: [x] Copy §7 intacto (sentence case); títulos = labels de nav
- D8: [x] Gate §8 recorrer por pantalla: estados intactos, control states intactos (`.btn` compartido), tokens-only, detector 0

## Nota

`/users` con guest renderiza main vacío: deuda pre-existente de deep-links sin
permiso (misma familia que la anotada en §6.7 para `/orders`); se documenta
como pendiente separado, no regresión de esta feature.
