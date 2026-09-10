# Machine Profiles & Postprocessor Adapters

> **Preparation scope — 2026-09-10:** [#650](https://github.com/tiagofur/muebleria/issues/650)
> define programa de corte único, preview fiel y serialización PTX documentada
> para un candidato CADLink/CAD4. El [dossier](../machines/ptx-cadmatic4/README.md)
> importa la investigación y ejemplos de la conversación. Es preparación, no
> implementación nueva. A+B se verifican internamente; generar cinco cocinas y
> verificar con el cliente quedan a cargo del propietario y fuera del cierre
> técnico. Esta separación permite desarrollar sin esperar #348, pero no
> promueve compatibilidad/capabilities ni elimina gates productivos.

> **Execution status — 2026-09-06:** FOUNDATION IMPLEMENTED, nothing validated.
> Tras el fallo real de conversión PTX en Client A
> (`docs/machines/client-a/ptx-conversion-failure.md`), el owner autorizó
> avanzar la implementación del lane de machine-output. Implementado en
> `packages/domain/src/machineOutput.ts` (contrato neutral) +
> `packages/excel/src/machines/` (adapters y perfiles DATA):
>
> - `PostprocessorAdapter` boundary + `OutputCompatibilityProfile` versionado
>   (concepto nuevo, ver §"OutputCompatibilityProfile" más abajo) con
>   fail-closed sobre toda dimensión sin evidencia;
> - perfiles `ptx-generic` r1 (dialeto actual del repo, byte-identical al
>   golden de #348), `ptx-cadmatic-3/4/5`, `saw-homag`, `mpr-woodwop` — todos
>   los últimos sin dimensiones evidenciadas → no generan bytes;
> - MachineProfiles HPP 250/BHX 050 (identidad OWNER_CONFIRMED, cero
>   capabilities inferidas) y ArtifactManifest determinista (provenance
>   exacta, claim `notClaimed`, banner non-production).
>
> **Implementación ≠ validación.** #348 (import/readback + sign-off) sigue
> abierto y gobierna todo claim; los dossiers #352/#353 siguen siendo la
> fuente de evidencia de campo. Este contrato no es un claim de compatibilidad
> para combinación alguna de máquina/controlador/software.
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
 └── declaredFormats: PostprocessorAdapterRef[] (adapters que puede servir)

PostprocessorAdapter
 ├── postprocessorAdapterId
 ├── postprocessorAdapterVersion (semver)
 ├── implementationDigest (hash del código que produce los bytes)
 ├── inputSchema (DTOs resueltos: p.ej. ResolvedBoardPart + drilling)
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

## OutputCompatibilityProfile (decisión 2026-09-06, alcance precisado 2026-09-10)

El modelo original distinguía `MachineProfile` (qué puede hacer la
máquina/instalación) de `PostprocessorAdapter` (serializador). El fallo real
de conversión PTX en Client A mostró la capa faltante: **cómo espera el
archivo el software receptor** (encoding, fin de línea, decimales, sintaxis de
registros, restricciones de nombre de archivo) no es una capability física ni
una decisión arbitraria del serializador.

```text
MachineProfile             = qué la máquina/instalación puede hacer
OutputCompatibilityProfile = cómo el software receptor espera el archivo
PostprocessorAdapter       = implementación del serializador (consume perfiles)
```

Reglas implementadas (`packages/domain/src/machineOutput.ts` +
`packages/excel/src/machines/profiles.ts`):

- Un perfil de compatibilidad es **DATA versionada e inmutable** (digest
  SHA-256 sobre datos canónicos; cambiar un valor publica revisión nueva).
- Toda dimensión sin evidencia de campo/repositorio vive en `pendingEvidence`
  como `FIELD_FORMAT_EVIDENCE_REQUIRED` y hace que el adapter falle cerrado.
  Los perfiles r1 actuales no cambian con este PR documental.
- **Readiness de un adapter = evidencia de formato/perfil + representabilidad
  de operaciones + disponibilidad de implementación del serializer.**
  `canSerialize(...).ready === true` garantiza que `serialize(...)` es
  ejecutable para ese job/profile. Un serializer pendiente reporta
  `SERIALIZER_NOT_IMPLEMENTED` incluso sobre perfiles totalmente evidenciados.
- Los perfiles con marca (CADmatic, woodWOP, SAW HOMAG) viven en la capa de
  export; el dominio neutral no contiene nombres de marca ni ramas por
  cliente/máquina.
- Un mismo `ResolvedCuttingJob` puede serializarse a N variantes explícitas
  en un kit de diagnóstico; generación normal sigue selección única #591.

### Implementación de candidato versus evidencia de instalación (#650)

El requisito anterior no prohíbe implementar la gramática de una **especificación
primaria de interfaz**, con fuente y localizador, para pruebas internas/candidato
no productivo. Eso es distinto de deducir sintaxis de artículos genéricos o llenar
capacidades físicas de una máquina desde su nombre.

#650 propone publicar una nueva revisión de perfil CAD4 y versión/digest del
serializer que apliquen realmente sus parámetros. El serializador consumirá el
mismo programa de corte que la preview, sin reconstruir por clustering X/Y ni
reoptimizar. Un lector independiente verificará los bytes contra ese programa.

Distinguir serialización posible, evidencia de receptor y permiso productivo.
La especificación pública no promueve `NOT_TESTED` a `PARTIAL/VALIDATED`, no
rellena limits de la instalación y no concede una `ProductionRelease`.
Generación productiva conserva los guards y la evidencia exacta existentes.

El objetivo es PTX → CADLink/CAD4 → archivo del receptor. SAW propio y MPR no
pertenecen a esta entrega. Las versiones 3/5 sólo se extienden por diferencias
pequeñas documentadas y probadas, sin claims cruzados ni requisito de cierre.

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
real y se versiona cuando su semántica cambia. `granete.*` es el namespace
neutro; perfiles concretos por cliente se aislan en machine packs (#352/#353).

## Flujo de export productivo

```text
AuthoringEnvelope → preflight (#347: negotiation contra MachineProfile)
                 → ready
                 → ProductionRelease (sólo Granete)
                 → PostprocessorAdapter(machineProfileRef, resolved DTOs)
                 → bytes + ManufacturingArtifactManifest (contract §12)
```

- El export re-checa `machineProfileId`, `machineProfileRevisionId`,
  `bomFingerprint`, `designRevisionId`, adapter ID/versión/digest.
- Un claim `validated|partial` exige evidence pack sanitizado;
  `notClaimed|unsupported` no puede adjuntarlo como prueba positiva.
- Stale revision bloquea salvo override auditado conforme al contrato.
- Un candidato no productivo no se presenta como esa cadena completada.
  #503/#577 conservan su ownership; no se evitan sus dependencias con datos
  mutables ni se absorben en #650.

## PTX como adapter inicial

PTX no es una regla global: es el primer `PostprocessorAdapter`. La foundation
se entregó mediante #588. #650 concreta su corrección documentada y la fidelidad
programa/preview/bytes. **Desarrollo interno no depende del cierre de #348;
compatibilidad de campo y habilitación productiva sí conservan esa evidencia.**

El requisito histórico de esperar #348 antes de cualquier implementación de
adapter fue superado por la foundation autorizada y este alcance técnico;
no interpretar ese cambio como exención de preflight, release o field claims.
No se implementan otros formatos de máquina con esta preparación.

## Qué está habilitado ya vs qué falta

**Implementado:** preflight neutral #347/F168, foundation #351/PR #588,
selección #591/PR #592 y robustez de descargas/ZIP PR #595/#598/#599.
El perfil disponible en una lista no demuestra gramática ni compatibilidad.

**Preparado, pendiente de implementar:** #650 A+B (programa real + preview y
serializer PTX + lector independiente), con diccionario y ejemplos bajo
[`docs/machines/ptx-cadmatic4/`](../machines/ptx-cadmatic4/README.md).

**Pendiente de field evidence:** compatibilidad de la combinación exacta y
capacidades reales (#348/#352/#353). Cinco cocinas y verificación con el cliente
las realiza el propietario fuera de #650. No bloquean su cierre técnico ni se
registran como PASS por exclusión.

## Referencias

- Contract §10/§11/§12: `docs/sketchup-manufacturing-contract.md`
- Preflight: `packages/domain/src/sketchupPreflight.ts` (F168)
- ADR-0001, ADR-0002; `docs/architecture.md` §6/§7
- Issues: #290, #347, #348, #351, #352/#353, #354, #591, #650
- Ledger histórico: F130 (DXF capas), F132 (SCM nativo), F168
- [Dossier PTX/CAD4](../machines/ptx-cadmatic4/README.md)

## Selección de salida y generación normal (#591)

```text
Validation pack:   puede evaluar múltiples candidatos (buildClientValidationPack).
Normal production: exactamente UN tuple configurado por operación
                   (máquina@revisión + perfil@revisión + adapter@versión/digest).
```

- La selección vive en `machine_output_selections` (tenant-scoped, versión con
  concurrencia optimista; `GET/PUT /api/machine-output-selections`, API
  generada) y se valida server-side contra el catálogo compartido
  (`contracts/machineOutputCatalog.contract.json`, paridad TS↔Go).
- El resolver autoritativo (`resolveManufacturingOutputTarget` en la capa de
  export) devuelve `NO_OUTPUT_CONFIGURED | CONFIGURED{tuple+readiness}` —
  nunca sustituye un perfil bloqueado ni genera candidatos en bulk.
- Un objetivo bloqueado produce **cero archivos** con la razón exacta
  (`machineOutputBlockerMessageEs`); el flujo legacy sin configurar se
  mantiene intacto y documentado. #650 debe mantener la ausencia de fallback
  y comunicar por separado candidato no productivo y compatibilidad real.
