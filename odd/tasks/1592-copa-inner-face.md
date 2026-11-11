# odd/tasks/1592-copa-inner-face

Issue: #1592 — la base fija de la bisagra (kit child body) se coloca a sideThickness hacia adentro en vez de sobre la cara interior del costado.
Lane: Delegated Direct. Writer: sesión 11-11. Base: origin/main 55aba8db. Rama: feat/1592-copa-inner-face (worktree 1592-copa-inner-face).

## Outcome observable

La placa fija (Copa, kit child `body`) de una bisagra de puerta se monta **sobre la cara interior del costado del lado de la bisagra** (furniture x = `W − tSide` o `tSide` según la mitad), pegada al costado por dentro — no flotando `sideThickness` hacia adentro del mueble.

## Fix

`resolveHardwareOrKitToWorld`: los kit-children `body` de tableros puerta aterrizan en la cara interior del costado (target furniture x por la mitad del placement — el branch `xMm <= w/2` existente ya discrimina el lado en el marco local volteado; conversión `local = board.x + w − target`). Firma extendida con `furnitureWidthMm` (2 call sites). El Brazo (`actor:door`) y los rieles de cajón quedan intactos (el branch sólo aplica a door boards).

## Verificación

- V0: go build + gofmt limpio en archivos tocados + go vet implícito por build.
- V1: `layout_hardware_kit_plate_test.go` (3 tests: alacena DER Copa=785/Brazo=778.5; IZQ espejo Copa=15/Brazo=22 con la receta real PW−20.5; fallback tSide=door thickness) + `layout_test.go` fixture actualizado a la receta IZQ real (PW−20.5) con la aserción re-pin a Copa=18 (cara interior) + suite engine completa verde + api verde.
- Nota anotada: `evaluatePartFormula` Go es entero (PW−20.5 → 377) — brecha half-mm ya documentada en #1591.
- V2 en vivo: owner — la base fija pegada al costado por dentro en SketchUp, igual en web.

## Delivery

PR Fixes #1592 / Delivery: complete (código+tests+CI); el vivo del owner queda como condición de cierre.
