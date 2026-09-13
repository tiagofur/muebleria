# Dossiers de máquina por cliente (machine packs)

> Estado: estructura de evidencia (#352/#353). **Un dossier es insumo de
> descubrimiento, no una validación.** Ningún pack certifica compatibilidad:
> los claims de máquina los gobierna
> [`docs/architecture/machine-profiles-and-adapters.md`](../architecture/machine-profiles-and-adapters.md)
> y el contrato de manufactura §10–§12
> (`docs/sketchup-manufacturing-contract.md`).

## Propósito

Un subdirectorio por cliente con identidad opaca (`client-a`, `client-b`, …).
Cada pack reúne los dossiers de campo de las máquinas reales de ese cliente —
**una máquina = un dossier**, siguiendo
[`docs/templates/machine-dossier-template.md`](../templates/machine-dossier-template.md) —
más su checklist de intake y los fixtures de validación futuros.

La ruta de habilitación productiva y claims conserva evidencia de campo exacta:

```text
#348 (validación PTX import/readback) → #351 (MachineProfile/PostprocessorAdapter)
     → #352/#353 (packs por cliente) → #354 (E2E) / #503 (workspace React)
```

**Aclaración de alcance — 2026-09-10:** la foundation #351 ya fue implementada
por PR #588; no confundir implementación con validación. La nueva
[#650](https://github.com/tiagofur/muebleria/issues/650) concreta el trabajo de
programa guillotina/vista previa y serializador PTX para un **candidato no
productivo** CADLink/CAD4, basado en fuentes primarias. Su programación y tests
internos no requieren cerrar #348 primero. Los claims, capabilities reales y
permiso productivo siguen sujetos a evidencia/preflight/release. El propietario
excluyó de #650 generar cinco cocinas y verificar con el cliente; lo hará por su
cuenta. No son criterios de cierre técnico ni una excusa para promover estados.

## Reglas de sanitización (obligatorias antes de que un dato entre al repo)

Prohibido en `docs/machines/`:

```text
nombre de cliente real, nombre de empleado, email, teléfono, dirección física,
precio, hostname, dirección IP, credenciales, password, token, share de red
privado, path privado, nombre real de proyecto o cliente
```

Usar sólo identificadores genéricos: `client-a`, `machine-a`, `machine-b`,
`sample-job-001`. Las fotos se sanitizan antes de adjuntarse; los archivos de
ejemplo se renombran y se revisan por metadatos. La correspondencia entre
`client-a` y la identidad real vive fuera del repositorio.

## Vocabulario de estado de evidencia

| Estado | Significado | Mapeo al contrato (§10) |
|---|---|---|
| `NOT_TESTED` | sin evidencia de campo recolectada | claim de evidencia `notClaimed` |
| `PARTIAL` | evidencia parcial de campo; import/readback incompleto | `partial` — exige `SanitizedEvidencePackRef` |
| `VALIDATED` | import/readback + sign-off del operador para la combinación exacta máquina/controlador/versión | `validated` — exige `SanitizedEvidencePackRef` |
| `UNSUPPORTED` | la evidencia demuestra incompatibilidad | `unsupported` |

Ningún estado se promueve con documentación pública: `PUBLIC_REFERENCE_ONLY`
nunca promueve `NOT_TESTED`. Una especificación primaria de interfaz puede
fundamentar un candidato de serialización bajo #650, no validar la máquina.

## Vocabulario de procedencia de un dato

| Etiqueta | Significado |
|---|---|
| `CLIENT_CONFIRMED` | confirmado con evidencia de campo de la máquina del cliente (foto, archivo, readback u operador) |
| `OWNER_CONFIRMED` | valor provisto por el owner de Granete (p. ej. modelo); requiere confirmación de campo antes de publicar capacidades de un `MachineProfile` productivo |
| `FIELD_VERIFICATION_REQUIRED` | desconocido; prohibido llenarlo desde conocimiento general del mercado |
| `PUBLIC_REFERENCE_ONLY` | dato de documentación pública/fabricante/terceros; **nunca es validación** y jamás se promueve a `CLIENT_CONFIRMED` sin evidencia de campo |

Las clasificaciones documentales de la investigación #650 no crean estados de
negocio ni cambian este vocabulario persistido.

## Reglas duras del pack

- Capabilities no se infieren por marca: un perfil declara sólo lo que el
  dossier demostró; lo no declarado es `unknown` y bloquea
  (`MACHINE_CAPABILITY_UNSUPPORTED`).
- Versiones de software distintas ⇒ perfiles distintos (revisión nueva del
  `MachineProfile`; nunca reinterpretación silenciosa).
- El pack de A no certifica a B, aunque compartan marca o formato (#353).
- El dominio industrial neutro no contiene nombres de marca (#351).

## Packs

| Pack | Máquinas conocidas | Estado |
|---|---|---|
| [`client-a`](./client-a/README.md) | `machine-a` (WEEKE BHX 050), `machine-b` (HOLZMA HPP 250) | `NOT_TESTED` — dossier de descubrimiento, sin evidencia de campo |

## Infraestructura común de validación

- [PTX/CADmatic 4 — estado operativo v0.7](./ptx-cadmatic4/README.md):
  runtime interno #650/#661/#665/#691/#692/#693, contrato r3, audit de fallback
  legacy y gate externo pendiente. Implementación completa dentro del
  subconjunto soportado; `NOT_TESTED/notClaimed` hasta CADLink/readback/operador.
- Auditoría del PTX actual, fixture sintético congelado `fixture-board-001` r1
  (golden con SHA-256), expected readback, contrato de comparación y runbook
  operator-safe: [`ptx-validation.md`](./ptx-validation.md) — preparación de
  #348, **sin claim de compatibilidad**. Los imports reales de cada máquina
  consumen ese fixture y registran su evidencia en el pack del cliente.
- Machine-output adapters + perfiles de compatibilidad versionados
  (#351 foundation, `packages/excel/src/machines/`): un adapter PTX sobre el
  serializador existente + perfiles `ptx-generic`/`ptx-cadmatic-3/4/5`,
  `saw-homag`, `mpr-woodwop` que **fallan cerrado** sin evidencia de formato,
  perfiles de máquina HPP 250/BHX 050 con cero capabilities inferidas, y el
  paquete de validación sanitizado para Client A
  (`buildClientValidationPack`). Implementación ≠ validación: todo sigue
  `NOT_TESTED` hasta import/readback + sign-off.
