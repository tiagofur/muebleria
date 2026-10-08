# ODD — #1136 Migración de jaladera-gola-* al modelo de grip

- **Issue**: tiagofur/muebleria#1136 (`status:approved`, type:refactor).
- **Lane**: Inline Direct (servicio + CLI + scan de storage, bounded, un
  escritor) con artefacto para recuperación — la EJECUCIÓN contra el DB vivo
  es un paso del owner con este mapa.
- **Base**: `origin/main` @ `4837528a` (post merge del PR de #1135). Rama:
  `feat/1136-jaladera-grip`, worktree `../muebles-worktrees/1136-jaladera-grip`.
- **Estado**: IMPLEMENTED_PENDING_REVIEW (mecanismo; corrida real = owner).

## Hallazgo que define el alcance

Los registros `jaladera-gola-*` NO viven en el repo: son herrajes del
catálogo vivo del owner (creados por UI, familia `JALADERA`), referenciados
por `option_overrides` de agregados en `modules.agregados` (JSONB). Por eso
el slice entrega el MECANISMO de migración trazable + reporte, no una
corrida: la corrida real es una decisión de datos del owner.

## Resultado observable

`go run ./cmd/admin migrate-opening-grips --org <uuid> --mapping <archivo>
[--apply] [--report <archivo>]` clasifica CADA registro de la familia en
una de cuatro categorías y —sólo con --apply— ejecuta lo declarado:

- **migrated** — el mapeo declara un perfil NUEVO (código, nombre,
  placements): se crea datasheet-pending (jamás verificado sin ficha).
- **already_canonical** — el mapeo apunta a un perfil existente de la org:
  se registra el vínculo, no se escribe nada.
- **unsupported** — el mapeo declara que NO hay equivalente grip: queda
  jaladera, intacto.
- **ambiguous** — sin mapeo: revisión manual, bloqueado. Los overrides de
  diseño (`modules.agregados` → `option_overrides` con valor de la familia)
  son SIEMPRE revisión manual: convertir uno en intención de apertura es
  una decisión de diseño (zonas, layout) que una migración jamás inventa.

## Decisiones de diseño

- **D1 Mapeo DECLARADO, nunca inferido de nombres**: el archivo de mapeo
  (esquema en `backend-go/data/opening-grip-migration.example.json`) es la
  decisión revisable del owner; el tool sólo ejecuta y reporta. Una entrada
  debe declarar EXACTAMENTE una salida; los placements de un perfil nuevo
  son declaración explícita del owner (el validador del mapping los exige —
  sin placements la entrada se rechaza, porque inferirlos sería inventar).
- **D2 Fail-closed ante mapeo rancio**: una entrada que apunta a un código
  inexistente en la org aborta la corrida COMPLETA antes de escribir nada
  (config error, no skip silencioso). Mapping inválido: rechazo en carga.
- **D3 Dry-run por defecto**: sin --apply no se escribe nada (el reporte
  clasifica igual). Con --apply jamás se tocan módulos: dimensiones y BOM
  quedan exactamente iguales — sólo cambian por el resolve canónico cuando
  un diseño adopte el modelo grip.
- **D4 Desactivación con doble guarda**: un registro clasificado
  migrated/already_canonical SIN referencias en overrides de diseño se
  desactiva (Active=false → deja de ofrecerse: "authoring deja de depender
  de jaladera-gola-*"); los referenciados quedan activos (son la cola de
  revisión manual) y la guarda #1215 de in-use re-verifica. Los herrajes
  comunes (fuera de la familia) no se escanezan jamás.
- **D5 Trazabilidad**: (a) el archivo de mapeo versionado en el repo —
  cada conversión ES una línea declarada; (b) el artefacto de reporte JSON
  (--report) con ids de herraje/perfil/módulo por registro y conteos por
  categoría; (c) re-corrida segura: la segunda pasada reclasifica las
  creaciones como already_canonical (idempotencia probada en test).
- **D6 Scan read-only**: `ScanModuleAgregadoOverrides` (SQL jsonb sobre
  `modules.agregados`, org-scoped, tolera agregados NULL/ausentes) SÓLO
  lee — la migración reporta overrides, jamás los reescribe.
- **D7 Perfiles nacen pending**: un perfil migrado no puede sortear el gate
  de evidencia (OQ-2); el test lo fija ("un perfil migrado nace pendiente,
  nunca verificado"). La ficha de Cymisa los habilita después por la vía
  normal (update If-Match).

## Fuera de alcance (explícito)

- La CORRIDA contra el DB vivo del owner (requiere su mapeo real; dry-run
  primero, --apply después, --report como evidencia).
- Reescribir overrides de diseño a intención de apertura: el portador de
  intención llega con las superficies de selección; esas conversiones son
  la cola de revisión manual de este reporte.
- Agregar columna de notas al perfil (la trazabilidad vive en el mapeo +
  reporte; una columna nueva exigiría migración+RLS completa para un dato
  que ya es durable en el repo).

## Cómo ejecutar (owner)

1. `go run ./cmd/admin migrate-opening-grips --org <uuid> --mapping mi-mapeo.json` (dry-run)
2. Revisar conteos y cola de revisión manual.
3. `... --apply --report migration-report.json` — guardar el reporte.

## Verificación

- Tests de servicio (stub): 4 categorías, dry-run sin escritura, overrides
  referenciados con sugerencia sin desactivar, mapeo rancio aborta sin
  escribir, mapping inválido rechazado, idempotencia de re-corrida.
- Test de storage (PG real): el scan encuentra exactamente los overrides de
  la familia, con código de módulo, e ignora valores ajenos y módulos sin
  agregados — corre en la suite de PG.
- `go build/vet` limpios en `...`, `internal/...`, `cmd/...`.

## Siguiente slice

#1137 Inspector *Apertura* en SketchUp — la primera superficie que envía
selecciones al validador (#1135) con las capacidades (#1134).
