# odd/tasks/1575-host-mirror

Issue: #1575 — El host renderiza el diseño ESPEJADO en X respecto a la web (compensar en el builder).
Lane: Delegated Direct (substantial, multi-file). Writer: sesión 11-10 (única; reclamado por
comentario en la issue). Base: origin/main 7559857d. Rama: feat/1575-host-mirror (worktree
muebles-worktrees/1575-host-mirror).

## Outcome observable

Un espectador de frente en SketchUp ve el mueble exactamente como la web lo presenta:
x=0 del engine a la DERECHA del espectador, +X hacia la izquierda. El experimento del owner
(gabinete 2P, izquierda sin X + derecha PW/2) se ve igual en ambas superficies; la cinemática
pivota donde están las bisagras en el mundo.

## Mecánica acordada (en la issue)

Reflexión sobre el plano x=W/2 del espacio del mueble, bakeada en NÚMEROS de placement
(sin instancias de determinante negativo para tableros; herrajes ya son det=±1 por #1280):

- Fórmula por frame (traslación t, basis B, extensión local en x = w_local):
  t̃.x = W − (t.x + w_local·bx.x); t̃.y = t.y + w_local·bx.y; t̃.z = t.z + w_local·bx.z
  B̃x = (bx.x, −bx.y, −bx.z); B̃y = (−by.x, by.y, by.z); B̃z = (−bz.x, bz.y, bz.z)
  det(B̃) = −det(B): tablero det=+1 queda propio ✓; herraje det=−1 queda espejado (legal) ✓.
- Espejar SÓLO la colocación externa de cada cadena: ensamble sí (T̃_a·T_m = S·M·(T_a·T_m)),
  miembros internos no. Board standalone sí. Herraje sí (punto: w_local=0) con mount_frame
  espejado igual. Path genérico (sin layout): pos.x' = W − pos.x − dims[0].
- La VERDAD no se espeja: metadata (assemblyTranslationMm, offsetMm, anchorFace, fingerprints)
  conserva los números del engine; sólo la geometría instanciada se refleja.
- W = native_layout.dimensions_mm[0]; sin él, fail-closed (raise), nunca adivinar el plano.
- Pivote #414: el adaptador deriva el borde pivote de las bisagras montadas EN EL MUNDO
  (hardware_by_host del comp); fallback = convención actual por side-string. #1574 queda con
  el payload/labels de la card.

## Tareas

1. LocalGeometry.mirror_placement (furniture_builder.rb) + tests de fórmula (propio, exacto).
2. Aplicar en render_native_board (standalone), render_native_assembly (sólo t_assembly),
   render_native_hardware (pos+basis+mount_frame via clon espejado del placement),
   create_generic_component (path genérico).
3. PresentationMotionAdapter: pivote desde bisagras en el mundo + tests.
4. Fixture de paridad: layout 2 mitades (izquierda x=0 / derecha x=W/2) → instancias
   intercambiadas en espacio del mueble; metadata con números del engine intactos.
5. Bump EXTENSION_VERSION (identity.rb) — CI gate.
6. rake unit + rubocop + verify_affected; PR Fixes #1575 / Delivery: complete.

## Verificación

- V0: rubocop 0 ofensas (318 archivos) + ci_extension_version PASS tras commit + diff readback.
- V1: rake unit 1486 runs / 0 fallos (incluye furniture_builder_mirror_test: intercambio del
  experimento del owner, basis propio bajo espejo, herraje al borde espejado, ensamble
  compuesto-entonces-espejado = 540 exacto, metadata con verdad del engine, envelope sin
  dimsMm, path genérico); rake boundary 6 runs 0 fallos; rake unidad completa del contrato
  28 runs.
- Correcciones de suites que asertaban world-x = engine-x (convención invertida a propósito):
  native_entity_renderer (expected calculado con la MISMA fórmula espejada), overlay_manager
  (banda espejada 582), furniture_builder hw (500→500: punto espejado 120), assembly_runtime
  d3/d5/d10 (590 / roles visuales invertidos / 1540 — verificados contra el valor real del
  fallo), material_rebuild (120 / −482 tablero sintético 500-wide), motion adapter
  (pivote por bisagras + fallback side-string intacto).
- Corrección media del diseño: layouts SIN dimensionsMm raíz (lane preview #469, DesignSync
  layout vacío) — W = envelope del propio layout (span real, un plano para todos los
  tableros); raise sólo con geometría y sin width ni envelope. El fail-closed estricto
  inicial rompía lanes vivas; el envelope preserva el plano correcto y los tests del preview
  pasan sin tocarlos.
- V2: SketchUp en vivo — NOT_RUN del lado del agente (host real); verificación del owner
  con su experimento 2P exigida por la aceptación de la issue antes del cierre.

## Forecast / delivery

~3 work units (builder+tests, motion+tests, identidad/docs). Delivery: complete exige toda
la aceptación demostrable en código+tests+CI; el vivo del owner queda como condición de
cierre de la issue (patrón #1555), no del PR. Riesgo: assets SKP asimétricos — mitigado por
aceptación en vivo (bisagras/jaladeras simétricas en práctica).
