# ODD 1264 — La geometría consume la resolución de apertura (V2 OPEN-FRONT)

Issue: #1264 (status:approved). Base: origin/main 1a7b06c7. Rama: feat/1264-opening-geometry.
Writer: agente ZCode (único escritor). Lane: Delegated Direct.

## El problema

«Aplicar» una gola = 1 PUT; los frentes resueltos son texto read-only; el layout nativo que el plugin consume (authoring resolve / GET layout) NO conoce `authoring_defaults.opening` — el mueble nunca cambia.

## Diseño (decisiones registradas, evidencia en los mapas Explore)

**Backend — el canal geométrico es el authoring resolve con designId:**

1. `POST /api/furniture/authoring/resolve`: `furniture.designId` opcional (UUID; fail-closed desconocido). Sin designId ⇒ byte-idéntico a hoy (paridad GET layout intacta).
2. Handler carga server-side (patrón `ReleaseServerInputs`): working copy → `authoring_defaults.opening` + dims del primer ítem → `ResolveDesignOpening` (pin-first, overhang rule) → `Fronts []OpeningResolvedFront`. Blocked/pending ⇒ rechazo estructurado con reason (OPENING_PROFILE_DATASHEET_PENDING etc.), JAMÁs layout degradado ni dims inventadas. Sin selección/dims ⇒ layout baseline.
3. Engine: `AuthoringResolveInput.Fronts`; pase post-`resolveLayoutBoards` sobre `[]layoutBoard`: boards de frente (placement `puerta`/`frente_cajon` ∪ isDoorBoard) reciben `lengthMm = front.HeightMm` y `z = baseZ + front.OffsetMm`; el ancho sigue siendo dueño de las fórmulas (la apertura v1 divide altura). El pase corre ANTES de `boardLocalPose` (AABB/transforms/machining derivan solos) y los boards de frente quedan EXENTOS de `authoredTranslation` (su posición vertical deja de ser authorable con apertura).
4. GET `/definitions/{id}/layout` queda intocado (definition-scoped por diseño).

**Plugin — converge tras aplicar:**

5. `resolved_native_layout` gana `design_id:` (del ModelBinding) en TODOS los caminos: place, update_furniture, restore — el snapshot mínimo del authoring resolve lleva designId.
6. `apply_design_opening` (bridge): tras PUT ok, si `dimsKnown && resolution.state==resolved`, re-resolver + `update_furniture(transaction:false)` de los muebles `present_synced` del diseño vía `Host::AuthoringMutationCoordinator` (1 undo, guards de contexto fresco, metadata en la operación, sin `authoring_dirty` — el cambio nació del servidor). Selección inválida: ni PUT exitoso ni rebuild (la card ya conserva draft+persistido).
7. Baseline: diseño sin apertura ⇒ layout byte-idéntico (paridad vigente). Bump `EXTENSION_VERSION`.

## Exclusiones / follow-ups explícitos

- Body modifiers (#1132) en el cuerpo: mismo seam, slice aparte (la aceptación de #1264 es frentes).
- Match zoneId↔componentInstanceId para highlight por frente: exige contrato backend nuevo; no se inventa local.
- Autoría de extremos de corrida y multi-zona (caso B): V3.
- Smoke real macOS/Windows: evidencia owner al final.

## Tareas

- [x] CU1 backend: designId en authoring resolve + Fronts input + pase de frentes + tests Go (paridad intacta, fail-closed pending, alcance primer módulo).
- [x] CU2 plugin: design_id en resolved_native_layout (place/update/restore/preview) + rebuild post-apply vía coordinator (execute_batch, 1 undo, authoring_dirty false).
- [x] CU3 card JS: outcome de geometría en la tarjeta (converged/failed honesto; respuestas tardías descartadas).
- [x] CU4 EXTENSION_VERSION 0.1.60 + wrapper CI del arnés JS + suites.

## Evidencia

- Backend (commit 7e505691): `go test ./internal/domain/... ./internal/api/` verde — pase de frentes (top achica desde arriba/bottom levanta/overhang extiende, holguras de autoría intactas, exención de traslación authorizada, fail-closed sin altura), API designId (716→676 con ficha 8006 38+2, 422 OPENING_PROFILE_DATASHEET_PENDING, alcance al primer módulo, sin designId byte-idéntico).
- Plugin: `bundle exec rake verify` COMPLETO verde (ruby 3.2): syntax + lint (0 ofensas) + **unit 1412 runs / 9996 assertions / 0 failures** (main: 1408) + boundary + RBZ 0.1.60 verificado (sha256 210069e9…).
- Bridge de apertura: 8 tests (converge con resolve pineado a designId + apply authoring_dirty:false + transaction:false + context guard; skipped sin dims; fallo honesto sin rollback del intento). Arnés JS: 10 tests (outcome converged/failed, tardío descartado). Wrapper `granete_opening_js_test.rb` lo corre en CI.
- Convención respetada: main.rb load list incluye los módulos nuevos; boundary prohíbe requires en bridges (model_binding carga por loader/test_helper).

## Estado

PR #1266 — CI 22/22 verde. IMPLEMENTED_PENDING_REVIEW. Smoke real macOS/Windows con RBZ 0.1.60 queda como evidencia owner (guion en el PR).

## Trampas encontradas (para memoria)

- Ruby 3: agregar un KWARG a un método cuyo callers pasan hash final posicional (choices `'FRENTE' => …`) lo convierte en kwargs → ArgumentError «unknown keyword». El 4º parámetro es POSICIONAL en toda la cadena (base incluida: StaticCatalogProvider define el método a 3).
- El coordinator queda «busy» (duplicate_submit en cadena) si un resolve lambda lanza fuera de su taxonomía — la causa raíz llegó por doble de aridad 3.
