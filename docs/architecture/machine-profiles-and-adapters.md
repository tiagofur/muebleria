# Machine Profiles & Postprocessor Adapters

> **Estado:** discovery (#351) — diseño aprobado para implementación futura.
> La implementación está hard-blocked hasta cerrar #348 (PTX field validation),
> que requiere dossiers reales de máquina (ver `docs/templates/machine-dossier-template.md`).
>
> **Invariante:** SketchUp owns authoring/interaction; Granete owns manufacturing
> truth. Los adapters serializan; no inventan reglas.

## Purpose

Modelar capacidades de máquina/software y aislar cada formato de salida (PTX,
DXF, scripts nativos) detrás de adapters delgados sobre manufacturing data ya
resuelta y validada por el preflight (#347). Un adapter conoce un formato; nunca
redefine BOM, joints, drilling, dimensiones ni release policy.

## Entidades

```text
MachineProfile
 ├── machineProfileId (stable)
 ├── machineProfileRevisionId (inmutable por publicación)
 ├── machine identity: maker, model, control software + versión exacta
 ├── capabilities: MachineCapability[]          (contract §10)
 └── declaredFormats: PostprocessorAdapterRef[] (qué adapters puede servir)

PostprocessorAdapter
 ├── postprocessorAdapterId
 ├── postprocessorAdapterVersion (semver)
 ├── implementationDigest (hash del código que produce los bytes)
 ├── inputSchema (DTOs resueltos que consume: p.ej. ResolvedBoardPart + drilling)
 ├── requiredCapabilities (qué capabilities exige del profile)
 └── producedArtifacts (kinds: ptx | dxf | csv | pdf | label)

EvidencePack (sólo para claims validated|partial)
 ├── evidencePackId + evidencePackRevisionId
 ├── sanitizedUri + checksum
 └── origen: import/readback + operator sign-off (#348)
```

Reglas:

- **Capabilities no se infieren por marca.** Un perfil declara lo que el
  dossier demostró; todo lo no declarado es unknown y bloquea
  (`MACHINE_CAPABILITY_UNSUPPORTED`, ya implementado en
  `runManufacturingPreflight`).
- **Versiones de software distintas ⇒ perfiles distintos.** Cambiar la versión
  del control publica una nueva revisión del perfil; nunca se reinterpreta
  silenciosamente.
- **Un adapter nuevo no modifica cálculos.** Conformance ADR-0001: consume
  DTOs resueltos; paridad vía contract fixtures compartidos si una regla
  viviera en TS y Go.

## Registro de capabilities canónicas

Las capabilities ya negociadas por el preflight (F168) son la semilla del
registro. Semántica de constraints: numéricos en mm; `max*` = límite superior
que la máquina cubre; `min*` = piso que la máquina no puede bajar de. Un
constraint requerido y no declarado bloquea.

| capabilityId | versión | constraints | derivada de |
|---|---|---|---|
| `granete.drilling` | 1 | `minDiameterMm`, `maxDiameterMm`, `maxDepthMm` | agujeros resueltos |
| `granete.panel-geometry` | 1 | `maxLengthMm`, `maxWidthMm`, `maxThicknessMm` | geometría de catálogo |

El registro crece sólo con evidencia: cada capability nueva nace de un dossier
real (número de husillos, paso de matriz, sierra, vacío, etc.) y se versiona
cuando su semántica cambia. `granete.*` es el namespace neutro de dominio; los
perfiles concretos por cliente se aislan en machine packs (#352/#353).

## Flujo de export

```text
AuthoringEnvelope → preflight (#347: negotiation contra MachineProfile)
                 → ready
                 → ProductionRelease (sólo Granete)
                 → PostprocessorAdapter(machineProfileRef, resolved DTOs)
                 → bytes + ManufacturingArtifactManifest (contract §12)
```

- El export re-checa el manifest: `machineProfileId`,
  `machineProfileRevisionId`, `bomFingerprint`, `designRevisionId`,
  `postprocessorAdapterId/Version/implementationDigest`.
- Un claim `validated|partial` exige evidence pack sanitizado;
  `notClaimed|unsupported` no puede adjuntarlo.
- Stale revision (§8) bloquea el export salvo override auditado.

## PTX como adapter inicial

PTX no es una regla global: es el primer `PostprocessorAdapter`. Su
implementación (#351 impl) empieza cuando #348 cierre con import/readback y
sign-off del operador sobre la combinación exacta máquina/software. Hasta
entonces, la ruta oficial hacia talleres SCM sigue siendo DXF por capas (F130),
importado por Maestro con asignación capa→herramienta (F132 quedó postergado
por la misma razón: sin máquina confirmada no se promete formato nativo).

## Qué está habilitado ya vs qué falta

**Ya implementado (F168, #347):** tipos §10 (`MachineProfileRef`,
`MachineCapability`, `CapabilityNegotiation`), `requiredCapabilities` derivadas
de verdad resuelta, negotiation bloqueante con todos los modos de falla,
overrides auditados, stale. `MachineProfile` (con identidad de software) y los
adapters/manifest/evidence packs quedan para la implementación de #351.

**Bloqueado por field evidence (#348, #352/#353):** perfiles concretos por
cliente, adapter PTX real, evidence packs, machine packs sanitizados. La
recolección usa `docs/templates/machine-dossier-template.md`.

## Referencias

- Contract §10/§11/§12: `docs/sketchup-manufacturing-contract.md`
- Preflight implementado: `packages/domain/src/sketchupPreflight.ts` (F168)
- ADR-0001, ADR-0002; `docs/architecture.md` §6/§7
- Issues: #290 (meta), #347 (cerrada), #348, #351, #352/#353, #354
- Ledger: F130 (DXF capas), F132 (SCM nativo, postergado), F168
