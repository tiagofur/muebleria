# Review — feature F188

**Veredicto:** CHANGES_REQUESTED

## Checkpoints

- C1: [x] Harness completo; `./init.sh` terminó con exit 0 usando Ruby 3.2.11,
  cache Go writable y acceso al registry.
- C2: [x] Hay una sola feature `in_progress` (F188) y
  `progress/current.md` describe correctamente esta sesión.
- C3: [x] El cambio respeta el boundary: Ruby sólo fusiona intención, consume
  `NativeLayout` y aplica geometría/transforms resueltos; no calcula espesor,
  orientación ni BOM.
- C4: [x] `./init.sh` completo verde: typecheck, 3.219 tests TS, backend Go y
  gate Ruby/RBZ. `bundle exec rake verify` también pasó de forma focalizada:
  162 tests / 1477 assertions + 3 / 801, sin fallos; RBZ
  `14a50b8397d183f9d342f41395981022ef7a4b49a12002ec27f3adb7dc9d7de8`.
- C5: [ ] La rama está limpia y completamente pushed, sin mezcla ajena, pero
  F188 continúa `in_progress`, no tiene entrada en `progress/history.md` y
  `progress/current.md` aún contiene la sesión. Esto es esperable antes de la
  aprobación, pero el cierre no puede marcarse completo todavía.

## Diseño UI/UX

No se modificaron `packages/ui/src/` ni CSS. Sin embargo, el flujo SketchUp ya
existente de alcance de materiales entra directamente en un criterio explícito
de #404; ver H2.

## Evaluación contra #404

La implementación de producción está bien encaminada y los unit tests cubren
BODY/FRONT, frentes de cajón, geometría 16→18, transforms, herraje, identidad,
world transform, copy-on-write de la definición superior, rollback y rechazo
de layout no nativo. También se verificó que #416 no fue implementada y los
Groups legacy siguen fallando cerrado.

## Hallazgos

### H1 — Falta la prueba host/round-trip exigida para el cambio material

La autoridad canónica exige para cambios de representación/interacción probar
en SketchUp real editar material, Undo y save/reopen
(`docs/architecture/sketchup-interaction-model.md:443-457`), y la matriz asigna
específicamente **material rebuild native hierarchy → Ruby host/round-trip** a
#404/#405 (`docs/architecture/sketchup-native-entity-model.md:864-871`).

Este branch sólo agrega pruebas sobre `SketchupStub`
(`apps/sketchup-extension/test/unit/material_rebuild_test.rb`). El smoke host
existente `TC_NativeEntitySmoke.rb` cubre el renderer #415 y un rebuild con el
mismo fixture (`:111-127`), pero no ejerce el flujo nuevo de #404: cambio de
`materialChoices`, `make_unique`, nueva geometría/anchors, metadata aceptada,
un único Undo ni rollback del estado anterior. Tampoco
`persistence_roundtrip_test.rb:17-52` guarda/reabre un modelo o prueba el
round-trip de `materialChoices` tras un update, aunque la issue lo exige
explícitamente.

Los stubs son buena evidencia unitaria, pero NO sustituyen esta prueba: #415 ya
demostró que el host real expone divergencias que los stubs no modelan. Sin ese
smoke no está demostrada la atomicidad real de `make_unique + clear! + purge +
set_attribute` ni el Undo/save-reopen del nuevo estado.

### H2 — “Valor por defecto de la obra” se presenta como actualizado aunque sólo vive en memoria del webview

#404 limita el soporte completo a “este mueble” y establece que un default
temporal de sesión no debe presentarse como manufacturing truth persistida. La
autoridad repite esa regla en
`docs/architecture/material-aware-furniture-resolution.md:523-567`.

Sin embargo, el diálogo ofrece **“Valor por defecto de la obra”**
(`resources/dialog.html:1740-1743`), guarda la elección únicamente en el objeto
JavaScript `projectDefaultMaterials` (`:1775`, `:3268-3269`) y confirma
**“Default de obra actualizado”** (`:3301-3304`, `:3322-3327`). No existe write
al Project/Design Digital Thread. Eso comunica persistencia de obra que no
ocurrió y viola el criterio de scope de la propia issue.

## Cambios requeridos

1. Extender el TestUp host smoke para ejecutar un cambio material real sobre el
   RBZ instalado y demostrar: layout 16→18, todas las piezas del role, posición
   dependiente/herraje, identidad + world transform, aislamiento FI-A/FI-B,
   una sola acción Undo que restaura geometría y metadata, y save/reopen con
   `materialChoices` preservados. Ejecutarlo en SketchUp real y guardar la
   evidencia, sin simularla.
2. No presentar el scope `project` como persistido: hasta #384, ocultarlo o
   etiquetarlo inequívocamente como default temporal de esta sesión (incluido el
   toast), con prueba del copy. No implementar persistencia Project/Design
   dentro de #404.
3. Tras resolver H1/H2 y aprobar la siguiente ronda, cerrar la sesión: F188
   `done`, entrada en `progress/history.md`, `progress/current.md` limpio y push.

