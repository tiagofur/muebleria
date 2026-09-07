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

Estos packs alimentan la cadena bloqueada por evidencia de campo:

```text
#348 (validación PTX import/readback) → #351 (MachineProfile/PostprocessorAdapter)
     → #352/#353 (packs por cliente) → #354 (E2E) / #503 (workspace React)
```

La implementación de perfiles y adapters permanece **hard-blocked** hasta que
#348 cierre con import/readback y sign-off del operador sobre la combinación
exacta máquina/controlador/versión de software.

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
nunca promueve `NOT_TESTED`.

## Vocabulario de procedencia de un dato

| Etiqueta | Significado |
|---|---|
| `CLIENT_CONFIRMED` | confirmado con evidencia de campo de la máquina del cliente (foto, archivo, readback u operador) |
| `OWNER_CONFIRMED` | valor provisto por el owner de Granete (p. ej. modelo); requiere confirmación de campo antes de publicar un `MachineProfile` |
| `FIELD_VERIFICATION_REQUIRED` | desconocido; prohibido llenarlo desde conocimiento general del mercado |
| `PUBLIC_REFERENCE_ONLY` | dato de documentación pública/fabricante/terceros; **nunca es validación** y jamás se promueve a `CLIENT_CONFIRMED` sin evidencia de campo |

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
