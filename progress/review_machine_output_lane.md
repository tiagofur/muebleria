# Review — machine-output lane (#348 prep + #351 foundation)

**Feature:** lane machine-integration Client A — ramas `feat/348-ptx-readback-validation-prep` (PR #587) y `feat/351-machine-output-adapters` (PR #588, apilada).
**Veredicto:** CHANGES_REQUESTED

## Checkpoints

- C1: [x] Harness completo; `./init.sh` verde al inicio de la sesión; `pnpm test` monorepo TS completo verde en HEAD revisado (domain 1274, storage 186, excel 142+3 skip declarados, mobile 73, desktop 17, ui 1612, web 424; 0 failures).
- C2: [x] Sin `in_progress` nuevo en `feature_list.json` (el lane se trackea por issues #348/#351/#352, sin cerrar); `progress/current.md` describe las sesiones activas.
- C3: [ ] **`AdapterSerializationBlocked` extiende `Error` directamente** (`packages/domain/src/machineOutput.ts:194`). CHECKPOINTS C3 exige errores de dominio como `DomainError` (o subclase) con contexto. Debe extender `DomainError` y llevar `reasons` también como `context`. (Nota: existen 2 precedentes que también violan — `FurnitureParameterDefinitionsError`, `AuthoringResolveResponseValidationError` — pero el checkpoint es explícito para código nuevo.)
- C3 (resto): [x] `packages/domain/machineOutput.ts` sin react/fs/xlsx; `packages/excel/src/machines/**` sin react/electron; sin `console.log` en runtime (sólo en emisores opt-in de tests, mismo patrón que fixtures existentes).
- C4: [x] Golden/fixture real: PTX adapter byte-identical al golden #348 (`sha256 544dcae5…`, lock en test); comparador readback con clasificación probada; 31 tests nuevos del lane.
- C5: [x] Nada sin push (`git log origin/<rama>..HEAD` vacío en ambas ramas; árbol limpio). Entrada de `progress/history.md` queda pendiente para el cierre real de la sesión (PRs abiertos).

## Convenciones (docs/conventions.md)

- **Tamaño de archivos:** `packages/excel/src/ptxReadback.ts` tiene **640 líneas** — presupuesto soft ~500 para módulos densos ("partir por dominio"). Se pide separar modelo/plantilla del comparador (`ptxReadback.ts` + `ptxReadbackCompare.ts`, index re-exporta). `ptxValidationFixture.ts` (621) se acepta: es DATA congelada de un fixture cuyo valor es la inspección completa en un archivo (una revisión = un artifacto).
- Fixtures: `machines/machineOutputFixtures.ts` no vive en `src/__fixtures__/`, pero es consumido por código runtime (`clientPack.ts` construye el pack sintético canónico) — es data de producto, no fixture de test. Aceptado con esa justificación.
- [x] Encabezado de propósito por módulo, imports ordenados, tipos `readonly`, copy en español, identificadores en inglés.

## Reglas duras del lane (AGENTS.md / dossiers)

- [x] Sin datos de cliente: artefacto fallido NO commiteado; evidencia sanitizada; pack 100% sintético.
- [x] Sin claims de compatibilidad: todo `NOT_TESTED`, manifest `notClaimed`, banner non-production; comparador sin estado VALIDATED.
- [x] Fail-closed: CADmatic/SAW/MPR sin evidencia no generan bytes (probado); operaciones MPR no se descartan en silencio (probado).
- [x] Dominio neutral sin marcas; perfiles con marca son DATA en capa excel; sin ramas por cliente/máquina.
- [x] Archivos de #577 no tocados (`backend-go/internal/domain/engine/**`, `packages/domain/src/engine/**`); sólo `progress/current.md` aditivo.

## Cambios requeridos

1. `packages/domain/src/machineOutput.ts`: `AdapterSerializationBlocked` debe extender `DomainError` (de `./errors`) exponiendo `reasons` también como `context` estructurado; tests siguen verificando `instanceof`.
2. `packages/excel/src/ptxReadback.ts` (640 líneas): partir — tipos/plantilla en `ptxReadback.ts`, comparador en `ptxReadbackCompare.ts`; `packages/excel/src/index.ts` mantiene la API pública re-exportando; imports de tests actualizados.
