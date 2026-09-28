# ODD — #471 Multi-selection and batch furniture editing

- Issue: #471 (status:approved, P1, SU-UX-3)
- Writer: GLM implementer (worktree `471-batch-editing`, rama `feat/471-batch-editing`)
- Base: `origin/main` @ `7c8d33f8` (2026-09-28)
- Lane: ODD (multi-incremento, recuperable). Este archivo es el único artefacto.

## Outcome

Un diseñador selecciona varios muebles administrados y cambia con seguridad al menos
un rol de material compartido y un parámetro compartido compatible: Inspector batch
con valores mixtos honestos, re-resolve autoritativo por mueble, todo-o-nada en UNA
operación SketchUp (un undo), sin persistencia de proyecto falsa.

## Scope

- Scope de batch: **selección actual únicamente** (PE:426, AC:415). El origen del
  conjunto es enchufable desde R1 (`origin: 'selection'`) para que #784 agregue el
  proveedor Design sin refactor.
- Operaciones: cambio de rol de material (R2), parámetro compartido compatible (R3),
  config de herraje si la superficie #468 lo permite (R4, evaluado).
- Excluidos explícitos: scopes durables project_default/room NO se reclaman (requiere
  #384/GATE A). El botón "Aplicar a muebles existentes…" de #784 NO está incluido
  (#471 es su primitivo, no su UI).

## Authority (verificada 2026-09-28)

- AC §16 (397-415): batch context = conjunto de identidades semánticas, jamás
  `selection.first`; sin fill implícito del primer valor; atomicidad explícita.
- DW §3.4 (189-199), §17 (823-827), §12 (592-615): Inspector batch con
  comunes/mixtos/no-soportados + conteo afectado + Apply explícito; un Apply = un
  undo coherente; footer de cambios pendientes.
- IM reglas 7/9 (521,523) y 334-344: material precede geometría; una edición de
  usuario = una operación atómica undoable; abort deja el mueble válido anterior.
- MA §9/§10/§12: cambio de rol → re-resolve completo del layout (nunca paint-only),
  propagación por rol a todas las piezas del rol; validación de choice falla loudly.
- PE §9 (220-244) + AGENTS shared sequence: resolve → preparar → UNA operación →
  rebuild → metadata → commit; nunca limpiar geometría válida antes del resolve.

## Current state (diagnóstico de código, base 7c8d33f8)

- `observers/selection_observer.rb:47` — `handle_selection` resuelve SÓLO
  `selection&.first` y etiqueta `selection_count`: hoy multi-selección = inspector
  del primer mueble con controles deshabilitados ("until batch editing exists",
  granete-inspector.js multi-note/fieldset).
- `selection/selection_context.rb` — contexto single-entity con `selection_count`
  accesoria; `identity_key` por kind+owner estable.
- `host/authoring_mutation_coordinator.rb` — pipeline single-command:
  begin_resolve (una MessageIdentity) → resolve_phase → complete con UN
  journal.start/commit_operation, verify_atomicity, restore_selection,
  invalidate_preflight. Late-response y stale guard ya existen.
- `ui/bridges/host_mutation_bridge.rb` — 'update_furniture' enruta a
  execute_coordinated_update; CommandContract parsea envelope versionado.
- JS: granete-inspector.js enruta por kind (null/unmanaged/furniture/child);
  multi hoy = nota + fieldset disabled. material-roles expone
  defaultMaterialChoices/renderMaterialSelectors para la base de roles.

## Plan de incrementos

### R1 — Batch selection context + Inspector batch de lectura
- `Selection::BatchContext` (o payload batch del observer): ≥2 muebles
  administrados → payload `kind:'batch'` con `furniture:[contexts]`,
  `excluded:[{kind,reason}]` (unmanaged/children excluidos con razón honesta — sin
  skip silencioso), `origin:'selection'`, capabilities batch = intersección por
  operación con razones.
- Observer resuelve TODAS las entidades (orden estable por identity_key; sin
  selección.first como autoridad — sólo orden de presentación).
- JS: carril batch en granete-inspector.js: resumen (N muebles, M excluidos),
  roles compartidos con tripartito común/mixto/no-soportado-para-todos,
  conteo afectado. Sin Apply aún.
- Tests: resolver/observer Ruby (fakes), harness JS render mixto.

### R2 — Apply batch de rol de material (todo-o-nada, un undo)
- Mutación `batch_update_furniture` vía CommandContract: comando compuesto con N
  sub-comandos; fase resolve ejecuta N resolves #477 (cada uno con MessageIdentity
  propia) ANTES de cualquier mutación de host; `complete` aplica los N rebuilds
  dentro de UNA journal operation; abort total ante cualquier fallo
  (ApplyRefused/error) — AC:413/ DW:827 contrato atómico.
- `context_still_valid?` batch = los N contextos válidos.
- Outcome honesto por mueble + agregado; UI jamás reporta 7/5.
- Impact preview pre-Apply desde resultados resueltos/disponibles (compatibles /
  afectados / no-soportados con razón).
- Tests: coordinator con resolve falso (éxito total, fallo en resolve medio →
  host intacto, fallo en apply medio → abort + undo), bridge, JS estados.

### R3 — Parámetro compartido compatible
- Mismo pipeline; compatibilidad por contrato de definición (nombre+tipo+rango
  intersección; valores mixtos mostrados como mixtos; AC:148-180 binding/consumer
  rules, fail-closed). Sin endpoint nuevo: N resolves secuenciales.

### R4 — Herraje (si #468 lo permite) + V2 host real
- Evaluar superficie canEditHighLevelHardware para config batch.
- TestUp host real: 3 muebles, un estado mixto, Apply → un paso de Undo restaura
  todo; guardado/reapertura conserva choices. RBZ + SHA registrados.

## Checks (por incremento)

- Focal Ruby: `ruby -Itest test/unit/<nuevos>_test.rb` + suites tocadas.
- `bundle exec rake verify` (lint + suite completa). JS harness vía tests Ruby existentes.
- Final: `verify_affected.py --base origin/main --plan` y selección V1/V2 una vez
  congelado el candidato.

## Forecast

R1 ~1 sesión; R2 ~1-2 (corazón del riesgo atómico); R3 ~1; R4 + smoke ~1.
Delivery: PR `Refs #471 / Delivery: partial|complete` según cobertura del DoD
(mín. un rol + un parámetro con UI mixta honesta y rollback coherente).

## Boundaries

- Sin endpoint batch nuevo en R1-R3 (N resolves secuenciales contrato-limpios);
  un batch-resolve server es optimización futura, no de esta issue.
- Sin cálculo client de BOM/impacto manufactura; impacto = conteos de
  compatibilidad desde definiciones/resolve, nunca manufactura.
- Sin scopes durables ni UI que los sugiera persistidos.
