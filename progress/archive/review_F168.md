# Review — feature F168 (#347 manufacturing preflight, DoD completo)

**Veredicto:** APPROVED

Commits revisados: `6a9fd2b` + `e01bd52` (main, pushed). Sin trabajo unpushed
(`git log origin/main..HEAD` vacío; working tree limpio salvo este review).

## Checkpoints

- C1: [x] Harness completo (AGENTS.md, init.sh, feature_list.json,
  progress/current.md, CHECKPOINTS.md, skills, docs canónicos). Nota
  preexistente: `docs/prd.md` no existe (la autoridad viva es `docs/prd-v2.md`
  + `docs/history/prd.md`); divergencia ya registrada, no causada por F168.
  `./init.sh` no se re-ejecutó en esta review (guardrail OC-001 documentado);
  en su lugar se ejecutaron directamente las suites reales.
- C2: [x] Cero features `in_progress` en el ledger; F163/F168 `done` con tests
  asociados que pasan; `progress/current.md` describe la sesión y el siguiente
  paso (#348).
- C3: [x] Boundary respetado: los módulos tocados (`sketchupPreflight.ts`,
  `sketchupAuthoringSchema.ts`, `sketchupAuthoringValidation.ts`,
  `sketchupRelationshipMachining.ts`, `index.ts`) importan sólo módulos internos
  de domain — sin react/fs/xlsx/electron (grep verificado). Resultados
  estructurados (`ContractIssue[]`) permitidos por architecture §13 para flujos
  multi-issue. Sin `console.log`. Sin duplicación TS/Go nueva (backend no
  tocado; enforcement server-side futuro consumirá los mismos contract
  fixtures según §7).
- C4: [x] Verificación real: preflight 19/19 (6 milestone + 13 DoD con pruebas
  negativas: capability ausente/versión/constraint/límite, override forjado en
  runtime NO degrada colisión, stale bloqueante, determinismo de fingerprint);
  domain 87 files/1106 tests; web 24/306; typecheck 7/7 workspaces;
  `go test ./...` ok. Fixtures desde `src/__fixtures__/` según convención.
- C5: [x] Sin archivos sin trackear sospechosos; `progress/history.md` con
  entrada F168; ledger refleja F163 (retroactivo) y F168 `done`;
  `progress/current.md` encabeza con la feature y el siguiente paso.

## Conformidad de dominio (ADR 0001 + contract + architecture §6/§15)

- Invariante respetado: el gate vive en Granete/domain; policy inputs
  (release/machineProfile/overrides) son contexto server-side que nunca viaja
  en `AuthoringEnvelopeV1` — imposible de bypassar desde SketchUp (test del
  override forjado lo exercising en runtime).
- "No ejecutar producción contra revisión stale sin override explícito"
  (architecture §15): implementado exactamente (REVISION_STALE error →
  bloqueo; override auditado → warning con registro).
- Capabilities nunca inferidas (ADR 0001 conformance "Unknown machine
  capability bloquea"): ausencia, versión, constraint omitido y límite
  insuficiente bloquean con `MACHINE_CAPABILITY_UNSUPPORTED` y cero output.
- Contrato §10/§11: tipos `MachineProfileRef`/`MachineCapability`/
  `CapabilityNegotiation` espejan el contract doc; §11 documenta los policy
  inputs server-side.
- Determinismo: mismo fixture → mismo `bomFingerprint`/`requiredCapabilities`
  (test); capabilities derivadas de agujeros/geometría resueltos, no de claims
  de authoring.
- Convenciones: tipos `readonly`, constantes UPPER_SNAKE, header de módulo,
  fixtures compartidos, un archivo de test por módulo. El estilo de comillas
  dobles en `sketchupPreflight.ts`/test preserva el estilo preexistente del
  archivo (mixto en domain; `sketchupAuthoringValidation.ts` usa simples).

## Cambios requeridos

Ninguno bloqueante. Follow-up no bloqueante para #351: al construir machine
profiles reales, mantener los IDs `granete.drilling`/
`granete.panel-geometry` y su semántica de constraints como contract fixture
compartido.
