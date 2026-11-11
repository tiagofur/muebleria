# odd/tasks/1573-cajon-fantasma

Issue: #1573 — la tarjeta Apertura ofrecía un «Cajón» fantasma por cada agregado de entrepaños (AGR-ENT-1 en alacenas/gabinetes) y su [Abrir] deslizaba contenido fijo.
Lane: Delegated Direct. Writer: sesión 11-11. Base: origin/main 69bdd541 (#1588). Rama: feat/1573-cajon-fantasma (worktree 1573-cajon-fantasma).

## Outcome observable

Un mueble con agregados de entrepaños (tablero suelto con assemblyInstanceId, sin frente y sin herraje) **no** emite actor de cajón: la tarjeta Apertura no ofrece deslizar contenido fijo. Cajones reales (frente + caja + rieles) y cajas sin frente con rieles móviles siguen intactos.

## Fix

Gate fail-closed en `build_drawers` (`door_actors.rb`): sólo emiten `DrawerActorData` los pares con frente, o con herraje del grupo (el scan enruta al grupo únicamente herraje actor:drawer / legado sin membresía). Un grupo de puros tableros es contenido del mueble, nunca un cajón. Sin capas de compatibilidad (directiva owner 11-11): el caso legacy con frente sigue el mismo camino de siempre.

## Verificación

- V0: rubocop 0 ofensas (318 archivos); EXTENSION_VERSION 0.1.113 → 0.1.114.
- V1: drawer_actors_test 6/6 (3 nuevas regresiones: grupo inerte sin actor; cajón real intacto junto al grupo inerte, entrepaño excluido de sus componentes; caja sin frente con rieles sigue abriendo) + suite completa 1490/0 + boundary.
- V2 en vivo: pendiente owner (alacena/gabinete con AGR-ENT-1: sin «Cajón» fantasma; MERIVOBOX/corredora abriendo normal).

## Delivery

PR Fixes #1573 / Delivery: complete (código+tests+CI); el vivo del owner queda como condición de cierre ya establecida en la issue.
