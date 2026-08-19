# Review — #108 Slice 4 (final): UI revision badges + Go handler pin capture

**RE-REVIEW tras fix BLOCKER.**

Commit: `0fde60b` — `feat(#108 slice 4): UI revision badges + Go handler pin capture`
Rama: `feat/structures-versioning-108`
Slices 1–3: APPROVED.

**VEREDICTO: APPROVED**

El implementer amendió el commit para revertir las 8 migraciones de tokens ajenas
(`--surface-border`→`--border-default`, `--surface-disabled`→`--surface-hover`) y reemplazó el
`hsl` hardcoded por `color-mix(in srgb, var(--accent-500) 10%, var(--surface-card))`. Ambos
issues del review anterior (B1 y L1) están cerrados. El resto del slice se re-confirma correcto.

---

## Verificación del fix BLOCKER

### 1. Sin scope creep — **PASS (era FAIL)**

```
$ git diff main -- packages/ui/src/structures/structures.css | grep "^[+-].*surface-border\|^[+-].*surface-disabled"
EMPTY - zero migrations
```

El grep está **vacío** (cero migraciones ajenas). El diff de `packages/ui/src/structures/structures.css`
**solo añade** 24 líneas al final del archivo, en dos bloques nuevos:

- `.structure-revision-badge` (regla nueva, totalmente perteneciente a #108)
- `.structure-revision-badge--pinned` (variante nueva, idem)

No hay líneas `-` (removed) fuera de los añfidels de las nuevas reglas. El estado pre-migración
(`--surface-border`/`--surface-disabled` en las cards existentes) se preserva, tal como pedía el
criterio 1 del pliego.

`git show --stat HEAD` confirma alcance exclusivamente #108 (12 archivos: apps/web/App.tsx,
backend-go handlers + tests, packages/ui structures/projects/modules, progress/impl_108_slice4.md).
Ningún `components.css`, playwright, ni feature 3D, ni migración de tokens.

### 2. Hardcoded `hsl` — **PASS (era NIT)**

`packages/ui/src/structures/structures.css:136` ahora usa:
```css
background: color-mix(in srgb, var(--accent-500) 10%, var(--surface-card));
```

Sin `hsl` hardcoded. Cumple `docs/design.md §7` regla 1. Usa `--accent-500` (token de design system)
en `color-mix` para derivar el fondo teal-claro sin introducir un nuevo token.

### 3. Tokens de design.md — **PASS**

Todos los tokens referenciados en `structures.css` (líneas 124-145) existen en
`packages/ui/src/design-system/tokens.css` Y en `docs/design.md`:

| Token | tokens.css | design.md |
|-------|-----------|-----------|
| `--text-xs` | :11 | :76 |
| `--weight-semibold` | :21 | — (present en tokens) |
| `--font-mono` | :9 | :74 |
| `--space-1`, `--space-2` | (spacing scale) | — |
| `--radius-sm` | :149 | :248 |
| `--accent-500` | :41 | :124 |
| `--accent-600` | :42 | :125 |
| `--surface-card` | :47 | :133 |
| `--surface-hover` | :49 | :135 |
| `--text-muted` | :56 | :145 |
| `--border-subtle` | :79 | :174 |
| `--border-default` | :80 | :175 |

Uso semántico correcto: variante default usa `--accent-*` (informativo); variante pinned usa
`--surface-hover` + `--text-muted` (audit / muted).

### 4. UI no calcula dominio — **PASS**

`packages/ui/src/structures/components/StructureRevisionBadge.tsx:26-36` — `resolveRevision`
solo hace `revision ?? 1` (legacy fallback) o acepta `revision` explícito. Sin BOM, sin fórmulas,
sin import de `@muebles/domain` más allá del tipo `Structure`. Badge puramente presentacional.

`packages/ui/src/projects/components/ProjectItemStructureRevisionIndicator.tsx:21-29` — wrapper
que pasa el `pin` (ya calculado por el shell) al badge con `variant="pinned"` y suffix `(cerrada)`.
Sin recálculo.

### 5. Handler Go correctness — **PASS**

`backend-go/internal/api/handlers.go` (bloque #108 dentro de `HandleProjectByID`):
- Captura solo al cerrar: `statusChanging && engine.IsProjectClosed(p.Status)` ✔
- Carga catálogo con `s.Store.GetFullCatalog(r.Context())` ✔
- Maneja error de `GetFullCatalog` sin pánico silencioso: `respondWithInternalError` + `return` ✔
- Llama `engine.CaptureProjectItemStructurePins(p.Items, catalog)` y asigna a `p.Items` ✔
- El pin corre antes del `UpdateProject` ✔

Sigue el patrón inline del `PriceSnapshot` justo encima (sin introducir `TransitionProjectStatus`).

### 6. Test F108 Go — **PASS**

```
$ cd backend-go && go test ./internal/api/ -run TestF108 -v
=== RUN   TestF108_ClosingQuotePinsStructureRevision
--- PASS: TestF108_ClosingQuotePinsStructureRevision (0.00s)
PASS
```

`backend-go/internal/api/handlers_test.go` — `TestF108_ClosingQuotePinsStructureRevision`:
fixture con proyecto draft + item + catálogo con estructura `Revision: 3`, PATCH `draft → quoted`,
assert `*pin == 3`. Significativo, cubre transition cerrada + pin capturado.

### 7. Integración UI — **PASS**

- `apps/web/src/App.tsx:1451-1459` — `updateStructure` ahora llama
  `bumpStructureRevision(s, draftToStructure(id, draft))` antes de reemplazar en el catálogo.
  Comentario justificativo.
- `packages/ui/src/structures/components/StructureListView.tsx:130-133` — badge junto al código
  de estructura.
- `packages/ui/src/modules/components/ModuleEditorStructurePanel.tsx:71-75` — badge al lado del
  `<select>` de estructura seleccionada.
- `packages/ui/src/projects/ProjectsScreen.tsx:1625-1630` — indicador pinned solo cuando
  `item.structureRevisionPin !== undefined`.
- `packages/ui/src/structures/index.ts` — exporta `StructureRevisionBadge`.

### 8. pnpm test + pnpm typecheck + go test ./... — **PASS**

```
$ pnpm test         # domain 199, storage 41, excel 25, ui 297, web 87, desktop 9 — todo verde
$ pnpm typecheck    # 6 paquetes Done (domain, ui, storage, excel, desktop, web)
$ cd backend-go && go test ./...    # api, auth, config, domain, engine, storage, db, admin — ok
```

`pnpm test` ui en 297 (incluye badge test nuevo), api con `TestF108` verde.

### 9. Badge test UI legacy — **PASS**

`packages/ui/src/structures/StructuresScreen.test.tsx` — test #108 verifica que para estructuras
legacy (sin `revision`) el badge normaliza a `Rev 1`.

---

## Checkpoints

- C1 Sin scope creep (solo archivos #108, cero migraciones ajenas): **[x]**
- C2 UI no calcula dominio (badge solo muestra `revision ?? 1`): **[x]**
- C3 Tokens de design.md (todos existen en tokens.css y design.md): **[x]**
- C4 Handler Go captura pins al cerrar, maneja error GetFullCatalog: **[x]**
- C5 Test F108 significativo: **[x]**
- C6 pnpm test + typecheck + go test ./... verdes: **[x]**
- C7 pnpm test ui +1 (badge test), api +TestF108: **[x]**

## Diseño UI/UX

- D1 Variables CSS del design system usadas (no hardcoded, color-mix para fondo teal): **[x]**
- D2 Patrón correcto para la pantalla (badge informativo junto a código, audit muted cuando pinned): **[x]**
- D5 Iconos Lucide (no aplica — el badge no usa iconos, solo texto mono): **[x]**

---

## Resumen

Ambos issues del review anterior están cerrados:

- **B1 (BLOCKER — scope creep):** revertidas las 8 migraciones de tokens. El grep
  `^[+-].*surface-border\|^[+-].*surface-disabled` en `git diff main -- structures.css` es vacío.
- **L1 (NIT — hsl hardcoded):** reemplazado por `color-mix(in srgb, var(--accent-500) 10%, var(--surface-card))`.

El feature #108 cierra aquí: bump de revisión al editar estructura (`App.tsx`),
badge `Rev N` en StructuresScreen y ModuleEditor, indicador pinned `Rev N (cerrada)` en
ProjectsScreen para items de cotización cerrada, captura de pin en handler Go al cerrar proyecto.
Todo verde, sin scope creep, sin hardcoded values, sin cálculo de dominio en UI.

Slice 4 APPROVED. Feature #108 completa.
