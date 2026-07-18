# Review — feature #108 (Slice 3): persist structure revision/history + pin in storage

**Veredicto:** APPROVED

> Commit `72cad65` en rama `feat/structures-versioning-108`.
> Working tree limpio al revisar (`git status` → nothing to commit).
> Archivos "fantasma" (apps/web/src/App.tsx, packages/ui/src/preview3d/*,
> ComponentsScreen.tsx) **NO están en HEAD** ni en working tree. Sin blocker.

---

## Criterios específicos del Slice 3

### C1 — Boundary PASS
`packages/storage/src/jsonFileStorage.ts:5-6` importa solo
`node:fs/promises` + `node:path`; resto de archivos de storage solo
`@muebles/domain` (types) y imports relativos. Verificado con grep sobre
todos los `.ts` de `packages/storage/src` (excluyendo tests):
ningún import de `react`, `electron`, o `xlsx`.

### C2 — Migración aditiva PASS
`packages/storage/src/jsonFileStorage.ts:65-101` (`migrateV2ToV3`):
- Backfill con `??` defaults (`revision: s.revision ?? 1`,
  `history: s.history ?? []`) — solo setea cuando falta; preserva
  existentes verbatim.
- Early return cuando no hay estructuras (`jsonFileStorage.ts:76-78`) o
  ninguna necesita backfill (`:80-85`) — no reescribe catálogo
  innecesariamente.
- Nunca lanza: casts through `unknown`, helpers `??`, `.map`. Sin acceso
  a propiedades no validadas.
- Integrado en `migrateWorkspace` (`:113-115`) con guarda `if (version < 3)`.

### C3 — Sin pin forzado en legacy PASS
`packages/storage/src/jsonFileStorage.ts:60-64` (comentario) + ausencia
total de `structureRevisionPin` en `migrateV2ToV3`. El migration solo
tocó `catalog.structures`, no `projects[].items`. Test
`workspace.test.ts:268-320` lo afirma explícitamente:
`expect(loaded.projects[0]?.items[0]?.structureRevisionPin).toBeUndefined()`.

### C4 — Default seguro `revision` PASS
- `apiMappers.ts:510` (`structureToApi`): `const revision = st.revision ?? 1`.
- `apiMappers.ts:548-550` (`structureFromApi`):
  `typeof revisionRaw === 'number' && Number.isFinite(revisionRaw) ? revisionRaw : 1`.
- `apiMappers.ts:493` (`structureRevisionFromApi`): `num(raw.revision, 1)`
  (helper `num` cae al fallback si no es número finito).
Test `apiMappers.test.ts:230-242` ("structureFromApi defaults missing
revision/history safely") lo cubre.

### C5 — Round-trip API PASS
`apiMappers.test.ts:182-217` ("round-trips structure revision + history"):
construye una `Structure` con `revision: 3` y `history` de 2 snapshots
(incluyendo `externalDims` por revisión), la serializa con
`structureToApi`, la recupera con `structureFromApi`, y afirma
`round.revision === 3`, `round.history?.[0]?.revision === 2`,
`round.history?.[0]?.externalDims?.height === 700`,
`round.history?.[1]?.name === 'Body v1'`.

### C6 — Snake_case ↔ camelCase PASS
`apiMappers.ts:515-517` emite `width_mm`/`height_mm`/`depth_mm`
(consistentes con `material_id`, `module_id`, `option_choices` del
archivo). Nuevo `structure_revision_pin` (`apiMappers.ts:772`) sigue el
mismo estilo que `measure_preset_id` (`:770`) y `option_choices` (`:769`).
`projectFromApi:856` acepta tanto `structure_revision_pin` como
`structureRevisionPin` (camelCase fallback) — coherente con otros
mappers del archivo.

### C7 — SCHEMA_VERSION bump justificado PASS
`packages/storage/src/seed.ts:13-20`: docstring documenta v3 =
adición de `revision`/`history`/`pin` (Slice 1). Bump 2→3 habilita
`migrateV2ToV3`. Tests actualizados:
`index.test.ts:12` y `apps/web/src/App.test.ts:131` (ajuste mecánico).

### C8 — Sin scope creep PASS
`git show --stat HEAD` confirma exactamente 9 archivos:
- `packages/storage/src/{seed,jsonFileStorage,apiMappers}.ts`
- `packages/storage/src/{seed,workspace,apiMappers,index}.test.ts`
- `apps/web/src/App.test.ts` (1 línea, ajuste mecánico de test)
- `progress/impl_108_slice3.md`
Cero cambios en `packages/domain`, `packages/ui` source, `apps/web`
source, `apps/desktop`, `backend-go`. Working tree limpio — sin
archivos fantasma commiteados ni sueltos.

### C9 — Tests cubren lo pedido PASS
- **Migración v2→v3 (tempdir real):** `workspace.test.ts:234-322`.
  Escribe JSON a disco vía `writeFile` (no mock), carga con
  `JSONFileStorage.load()`, verifica schemaVersion 3, defaults legacy,
  preservación verbatim, y item sin pin.
- **Round-trip pin (pinned/unpinned):** `apiMappers.test.ts:244-290`.
  Cubre pinned (pin=3 → API 3 → domain 3) y unpinned (sin pin → API
  `null` → domain `undefined`).
- **Defaults legacy:** `apiMappers.test.ts:219-242` (toApi y fromApi
  por separado) + `apiMappers.test.ts:292-318` (projectFromApi tolera
  `structure_revision_pin: null`).

---

## Checkpoints generales

- C1 (harness): [x] (sin cambios)
- C2 (estado coherente): [x]
- C3 (arquitectura): [x] — storage respeta boundary (fs + domain solo)
- C4 (verificación real): [x] — tempdir real, no mock fs
- C5 (cierre): [x] — working tree limpio

## Autoverificación independiente

```
$ git show --stat HEAD     → 9 archivos, alcance confirmado
$ pnpm --filter @muebles/storage test  → 41/41 verdes
$ pnpm typecheck            → 6/6 paquetes Done
$ pnpm test                 → 657/657 verdes
  (domain 199, storage 41, excel 25, ui 296, desktop 9, web 87)
```

## Issues por severidad

- **Blocker**: ninguno.
- **Major**: ninguno.
- **Minor / Nits (no bloqueantes, meras observaciones):**
  1. `apiMappers.ts:548-550` replica la lógica de `num(raw.revision, 1)`
     inline en lugar de reutilizar el helper `num()` como sí hace
     `structureRevisionFromApi:493`. Comportamiento idéntico, solo DRY.
  2. `structureRevisionFromApi` no incluye `notes` ni `active` en el
     snapshot — correcto y alineado con `snapshotStructureRevision` del
     dominio (Slice 1, `versioning.ts:39-50`), pero no está testado
     explícitamente que el snapshot NO contenga esos campos. Cubertura
     implícita vía round-trip.
  3. `seed.test.ts:51-66` afirma `s.revision ?? 1 === 1` lo cual pasa
     tanto si `revision === undefined` como si `revision === 1`. No
     distingue, pero es justo lo que se quiere (cualquier normalización
     válida). Bien.

## Observaciones positivas

- Decisión acertada de **no migrar `structureRevisionPin`** y dejarlo
  documentado en el comentario `jsonFileStorage.ts:60-64`: legacy sin
  pin = revisión live, no congela BOMs que nunca se congelaron. Cumple
  el plan.
- Defaults asimétricos **bien justificados**: `history: []` explícito en
  disco (queremos ser explícitos), `history: undefined` en
  `structureFromApi` (no ensucia el domain). Consistente con
  `presets`/`components` existentes.
- Tolerancia bidireccional en `projectFromApi`: acepta `snake_case` y
  `camelCase` para `structure_revision_pin` — consistente con otros
  mappers.
- Comentarios en código explican el *porqué*, no el *qué*. Citas al
  issue y al Slice 1 facilitan auditoría.
