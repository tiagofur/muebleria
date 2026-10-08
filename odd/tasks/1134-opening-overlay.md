# ODD — #1134 Overlay de capacidades de apertura `opening.*` + Web settings

- **Issue**: tiagofur/muebleria#1134 (`status:approved`, épica OPEN-FRONT).
- **Lane**: Delegated-like Direct de superficie completa (contrato + API +
  Web), un escritor; artefacto para recuperación — es la PRIMERA superficie
  de authoring del sistema de apertura: desde aquí los diseños empiezan a
  poder portar intención.
- **Base**: `origin/main` @ `2ec569f0` (post merge del PR de #1133). Rama:
  `feat/1134-opening-overlay`, worktree `../muebles-worktrees/1134-opening-overlay`.
- **Estado**: IMPLEMENTED_PENDING_REVIEW.

## Resultado observable

La fábrica configura qué sistemas de apertura OFRECE para autoría nueva
(jaladera / gola / rebase inferior), cuál va preseleccionado, qué perfiles
gola cura, y restricciones/defaults por tipo de mueble (inferior | superior |
alto). El estado vive en el blob `opening.capabilities` del overlay activo de
la biblioteca estándar (mismo mecanismo que `joint.constructionPolicy`).
Available ≠ valid: deshabilitar nunca reescribe ni invalida diseños
existentes — resuelven contra su release fijado.

## Decisiones de diseño

- **D1 Un blob versionado, patrón construction**: `opening.capabilities`
  (literal plano con objeto estructurado, version 1). Versión futura ⇒
  ERROR (no hay fallback granular a dónde caer — el overlay ES la decisión;
  "no interpretar" es el fail-closed honesto). Clave desconocida en
  CUALQUIER nivel ⇒ error: es lo que mantiene fuera dimensiones — cada mm
  pertenece a la ficha del OpeningProfile (el caso `maxReductionMm` del test
  lo prueba).
- **D2 Parsers gemelos, un fixture**: `ParseOpeningCapabilities` (Go engine)
  y `parseOpeningCapabilities` (TS domain) consumen
  `contracts/openingCapabilities.contract.json`. Vocabularios cerrados:
  sistemas handle|gola|bottom_overhang, tipos inferior|superior|alto,
  placements top|between|bottom; a lo sumo UN sistema default; profiles
  (curaduría de ids exactos) sólo en gola; absent = curaduría pendiente,
  nunca wildcard.
- **D3 Lectura API espejo**: `GET /api/catalog/opening-capabilities`
  (Store.GetOpeningCapabilities → overlay activo → parser; nil sin overlay;
  overlay roto ⇒ 500 fail-closed, jamás default silencioso). RBAC: lectura
  miembro (estado de catálogo); escritura por el camino overlay existente
  (admin de fábrica, `updateLibraryOverlay`).
- **D4 Escritura con merge de claves propias** (lección #943):
  `saveOpeningCapabilities` upserta SOLO `opening.capabilities` — la
  política de construcción y toda clave ajena del overlay sobreviven.
  Sin overlay activo, el release estándar actual siembra uno nuevo. La
  activación de drafts de construcción fusiona sólo claves propias, así
  que tampoco pisa esta clave.
- **D5 Sección Web con honestidad de procedencia**: OpeningSettingsSection
  distingue "Sin decisión de fábrica" (defaults de biblioteca visibles,
  `decided=false`) de decisión activa; un sistema deshabilitado se muestra
  «no disponible para nueva autoría»; la nota de persistencia (los diseños
  existentes no se tocan) está en la sección. Sin campos de milímetros.
  Guardado con acción primaria propia de la sección (no enganchado al
  guardar general de preferencias).
- **D6 Available ≠ valid probado en test**: capacidades con gola
  deshabilitada NO invalidan un diseño que la declara (resuelve igual);
  capacidades habilitadas NO lavan una ficha pendiente (el bloqueo
  OQ-2 sigue). La oferta vive en las capacidades; la validez, en el
  resolver contra evidencia y release pineado.

## Fuera de alcance (explícito)

- El SELECTOR de apertura en la authoría de muebles (qué opciones ve el
  diseñador al componer) — llega con la migración de jaladeras (#1136) y el
  Inspector (#1137), que son quienes portan la intención.
- Rebase/conflicts/draft flow para la sección de apertura (usa el write
  directo con merge; el flujo de drafts sigue siendo de construcción).
- Validación `INVALID_OPENING_CONFIGURATION` (#1135).

## Verificación

- Go: parser + fixture de paridad + fail-closed + available≠valid + handler
  (envelope nil/parsed/método) — build/vet/test internos verdes.
- Suite backend completa con PG desechable (`scripts/backend-test.sh`):
  VERDE (toca storage: nuevo método de lectura).
- `pnpm typecheck` workspace limpio; `pnpm test` raíz VERDE (12 tests
  domain + 5 tests del componente; suites existentes intactas).

## Siguiente slice

#1135 validación `INVALID_OPENING_CONFIGURATION` (available vs valid con
gate de selección) — ya puede apoyarse en `availableOpeningSystems` y las
restricciones por tipo de este overlay.
