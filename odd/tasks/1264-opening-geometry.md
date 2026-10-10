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

- [ ] CU1 backend: designId en authoring resolve + Fronts input + pase de frentes + tests Go (paridad intacta, golden apertura, fail-closed pending).
- [ ] CU2 plugin: design_id en resolved_native_layout (place/update/restore) + rebuild post-apply vía coordinator.
- [ ] CU3 card JS: outcome del rebuild en la tarjeta (estado honesto si la geometría no converge).
- [ ] CU4 EXTENSION_VERSION bump + suites Ruby/JS + PR.

## Evidencia

(cargar al validar)
