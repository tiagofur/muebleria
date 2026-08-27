# Sesión

**Feature en curso:** F185 — TRANSFORM LOCAL→FURNITURE AUTORITATIVO EN EL LAYOUT RESUELTO (#414 / SU-ENT-1) (COMPLETADA; ver `progress/history.md` y `progress/review_F185.md`)
**Cerrados con evidencia (ledger done):** F169–F184 (PRs #419/#424/#427/#428/#431/#432)
**Rama:** `feat/414-local-transform-contract` (desde origin/main post-#432)
**Inicio:** 2026-08-27
**Contexto:** programa #413 (SketchUp native entity model). Prerequisites
verificados mergeados: #418 docs+ADR-0004 (PR #420), #402 espesor efectivo en
Go layout (PR #431), #403 binding roles (PR #432). Este slice desbloquea #415
(renderer nativo) y es exclusivamente contract/resolver/parsing.

## Problema

`LayoutComponent` publicaba dimensiones locales (`lengthMm/widthMm/thicknessMm`)
y un AABB world (`transform.translationMm` + `dimensionsMm`), pero la rotación
sólo existía en el `layoutBoard` interno (`rotX/rotY/rotZ`, Euler XYZ en el
frame render Y-up). Suficiente para cajas pre-horneadas; insuficiente para
crear una `ComponentDefinition` nativa con ejes locales estables y posicionar
la instancia — Ruby habría tenido que inferir orientación por slot/role/AABB.

## Diseño entregado

1. **Marker de contrato:** `FurnitureLayout.transformContract =
   "granete.local-basis.v1"` (`LayoutTransformContractV1`). Cliente que no lo
   reconoce debe fallar seguro — nunca reinterpretar campos nuevos.
2. **Transform autoritativo:** `LayoutComponent.localTransform =
   {translationMm, basis{x,y,z}}` con
   `furniture_point = translationMm + basis · local_point` y caja local
   `[0,width]×[0,thickness]×[0,length]` (convención local X=width/Y=thickness/
   Z=length CONSERVADA).
3. **Representación: base ortonormal diestra** (det=+1). Sobre Euler (orden
   ambiguo — prohibido exportarlo por comodidad) y quaternion (orden de w +
   ruido trig en 90°): las entradas son exactamente 0/±1 en los placements
   estándar y mapea 1:1 a `Geom::Transformation.axes` en Ruby.
4. **Decisión de frame (la explícita que el issue permite):** la rotación
   interna vive en el frame render (Y-up); render→furniture es el swap Y/Z —
   un espejo (det −1). La imagen fiel del frame local del engine sería
   LEFT-handed: no es una rotación y espejaría geometría en SketchUp. El frame
   local publicado conserva extents y semántica de caras (+Y hacia la cara
   frontal, +Z hacia la superior — paridad con hardwarePlacement.ts) pero
   espeja +X local; la traslación compensa un ancho a lo largo de la imagen de
   +X local, así la caja ocupa EXACTAMENTE la región física del AABB legacy.
   Implementado en `boardLocalPose` (layout.go).
5. **AABB derivado:** `aabbFromLocalTransform` — el AABB publicado se deriva
   del transform (única fuente, imposible que diverjan) + chequeo runtime
   contra el pose del engine (desacuerdo > 1e-6 ⇒ error loud). Los tests
   preexistentes que clavaban valores AABB pasan sin cambios.
6. **Validación server-side:** `validateLayoutBasis` exige unitaria/ortogonal/
   diestra (det +1) y finita; espejos/colapsos/NaN nunca se publican.
7. **Material-aware (#402):** el transform se computa del board YA resuelto
   con espesor efectivo del MaterialBoard seleccionado (mismo T en fórmulas,
   pose, caja local, transform y AABB).
8. **Ruby parser:** `library/layout_contract.rb` (`LayoutContract.parse!` +
   `BaseCatalogProvider#resolved_native_layout`). Exige el marker exacto,
   valida basis (unitaria/ortogonal/diestra, tolerancia 1e-4), triples y
   escalares positivos; falla loudly (`ContractError < LayoutResolutionError`)
   ante contrato ausente/desconocido o payload malformado. AABB es passthrough
   opcional y NUNCA fuente de orientación. Cero tabla slot/role→rotación.
   El renderer Group actual NO se tocó (sigue AABB; #415 lo cambia).
9. **Golden compartido:** `contracts/sketchupLayoutTransform.contract.json`
   generado desde el resolver Go (`UPDATE_LAYOUT_CONTRACT_GOLDEN=1`), consumido
   textual por los tests Ruby del parser — paridad real de wire shape.

## Evidencia

- `go test ./...` backend-go completo: OK (incl. layout_test.go previo sin
  cambios — paridad AABB exacta — y regression_402/403).
- Tests nuevos Go (`layout_transform_test.go`): marker; boards canónicos
  (lateral/piso/techo/fondo/puerta con bases ancladas); paridad AABB derivada
  (8 esquinas, con dims overrides); espesor mixto 16/18/6 antes del transform;
  agregado (3 frentes cajón, identidad); host de herraje atado a
  componentInstanceId con transform válido; NEGATIVE PROOF (dos customs con
  mismo slot/nombre/AABB y bases distintas); validateLayoutBasis negativos
  (espejo/no-unitaria/NaN/skew); golden serialization API.
- API test: endpoint sirve transformContract + localTransform en el wire.
- Ruby `bundle exec rake verify` (syntax+lint+unit+boundary+RBZ): OK.
  Tests Ruby del parser: golden servido, fail-safe contrato ausente/desconocido/
  malformado, negative proof (slot renombrado no cambia transform; AABB
  opcional), integración provider + estáticos nil.
- `pnpm test`/typecheck TS: sin cambios de código TS (verificación de no-regresión).

## No-goals respetados (issue #414)

- Renderer nativo (#415): no tocado; FurnitureBuilder sigue con AABB.
- Material rebuild (#404): no tocado.
- Heurísticas Ruby: no existen; el parser no lee slot/role/AABB para orientación.
