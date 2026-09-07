# Machine pack `client-a`

> Issue: [#352](https://github.com/tiagofur/muebleria/issues/352) — entrega
> **parcial**: dossier de descubrimiento y preparación de evidencia.
> Estado de ambas máquinas: **`NOT_TESTED`**. Este pack **no** afirma
> compatibilidad. La identidad real del cliente no existe en este repositorio.
>
> **2026-09-06 — evidencia de campo:** un PTX generado por Granete fue enviado
> al cliente y su software **falló al convertirlo en archivos de máquina**
> (`REAL_FIELD_RED`; el estado de validación sigue siendo `NOT_TESTED`).
> Registro y respuesta: [`ptx-conversion-failure.md`](./ptx-conversion-failure.md).
> Paquete de validación sintético y procedimiento:
> [`client-test-procedure.md`](./client-test-procedure.md).

## Máquinas conocidas

Las dos máquinas pertenecen al mismo cliente (identidad opaca `client-a`).
Los nombres de modelo se registran porque fueron provistos por el owner de
Granete (`OWNER_CONFIRMED`); todo lo demás está pendiente de evidencia de campo.

| Clave | Fabricante (familia) | Modelo | Rol | Estado | Dossier |
|---|---|---|---|---|---|
| `machine-a` | WEEKE / HOMAG | BHX 050 | centro de mecanizado/perforación CNC de panel | `NOT_TESTED` | [`machine-a-bhx050.md`](./machine-a-bhx050.md) |
| `machine-b` | HOLZMA / HOMAG | HPP 250 | sierra de formato (panel dividing / beam saw) | `NOT_TESTED` | [`machine-b-hpp250.md`](./machine-b-hpp250.md) |

## Matriz de estado requerida

| Campo | BHX 050 | HPP 250 | Evidencia |
|---|---|---|---|
| Modelo | BHX 050 | HPP 250 | `OWNER_CONFIRMED` |
| Fabricante (familia) | WEEKE / HOMAG | HOLZMA / HOMAG | `OWNER_CONFIRMED` |
| Variante / año / serie | `FIELD_VERIFICATION_REQUIRED` | `FIELD_VERIFICATION_REQUIRED` | missing |
| Controlador | `FIELD_VERIFICATION_REQUIRED` | `FIELD_VERIFICATION_REQUIRED` | missing |
| Software de máquina | `FIELD_VERIFICATION_REQUIRED` | `FIELD_VERIFICATION_REQUIRED` | missing |
| Versión exacta (control/software) | `FIELD_VERIFICATION_REQUIRED` | `FIELD_VERIFICATION_REQUIRED` | missing |
| Formato de entrada aceptado | `FIELD_VERIFICATION_REQUIRED` | `CLIENT_CONFIRMED` (relay owner): PTX aceptado hasta el paso de conversión, que **falló** (2026-09); SAW declarado aceptado, sin probar | [`ptx-conversion-failure.md`](./ptx-conversion-failure.md) |
| Método de transferencia/red | `FIELD_VERIFICATION_REQUIRED` | `FIELD_VERIFICATION_REQUIRED` | missing |
| Unidades / origen / convención de ejes | `FIELD_VERIFICATION_REQUIRED` | `FIELD_VERIFICATION_REQUIRED` | missing |
| Capacidades físicas verificadas | `FIELD_VERIFICATION_REQUIRED` | `FIELD_VERIFICATION_REQUIRED` | missing |
| Validación (import/readback + sign-off) | `NOT_TESTED` | `NOT_TESTED` — conversión PTX fallida en campo (regresión abierta) | [`ptx-conversion-failure.md`](./ptx-conversion-failure.md) |

Ningún valor se llena desde conocimiento general del mercado; lo público vive
separado como `PUBLIC_REFERENCE_ONLY` dentro de cada dossier.

## Contenido del pack

```text
docs/machines/client-a/
├── README.md                 ← este archivo (identidad, matriz, mapping)
├── machine-a-bhx050.md       ← dossier BHX 050 (descubrimiento + fixture futuro)
├── machine-b-hpp250.md       ← dossier HPP 250 (descubrimiento + fixture futuro)
├── intake-checklist.md       ← checklist de evidencia para el operador
├── ptx-conversion-failure.md ← evidencia REAL_FIELD_RED del fallo de conversión PTX (2026-09)
└── client-test-procedure.md  ← runbook del paquete de validación sintético
```

Cada dossier instancia
[`docs/templates/machine-dossier-template.md`](../../templates/machine-dossier-template.md)
(una máquina = un dossier) extendido con la matriz de descubrimiento y el
contrato de entrada/salida exigidos por #352.

## Mapeo arquitectónico (revisión contra #348/#351)

El modelo existente en
[`docs/architecture/machine-profiles-and-adapters.md`](../../architecture/machine-profiles-and-adapters.md)
y el contrato §10–§12 **es suficiente**: no se crean conceptos paralelos.

| Entidad existente | Uso previsto para `client-a` (cuando haya evidencia) |
|---|---|
| `MachineProfile` | un perfil por combinación exacta máquina + controlador/software + versión; identidad de software desde el dossier |
| `MachineProfileRevision` | publicación inmutable; cambiar la versión del software publica revisión nueva, nunca reinterpretación silenciosa |
| `MachineCapability` | capabilities `granete.*` con constraints en mm, sólo con lo demostrado por el dossier (semilla vigente: `granete.drilling`, `granete.panel-geometry`) |
| `PostprocessorAdapter` | un adapter delgado por formato aceptado (p. ej. el family woodWOP/MPR de `machine-a`; el formato de corte aceptado por CADmatic en `machine-b`); serializa verdad ya resuelta, no inventa reglas |
| `EvidencePack` | pack sanitizado + checksum por claim `partial|validated`; sin paths privados ni identidad de cliente |
| `ManufacturingArtifact` | manifest §12 con `machineProfileId`, `machineProfileRevisionId`, `bomFingerprint`, `designRevisionId`, adapter id/version/digest y `compatibilityEvidence` |

Brechas detectadas: **ninguna estructural.** La única decisión abierta es de
ownership del plan de corte para `machine-b` (¿Granete genera el plan final o
CADmatic lo optimiza?) — documentada como pregunta arquitectónica con la
evidencia de campo necesaria para decidirla en
[`machine-b-hpp250.md`](./machine-b-hpp250.md), sin crear conceptos nuevos.

## Qué promueve el estado de este pack

- `NOT_TESTED → PARTIAL`: llegada de evidencia del checklist
  [`intake-checklist.md`](./intake-checklist.md) (identidad de máquina, versión
  exacta, formatos con ejemplo real) — sigue sin afirmar compatibilidad.
- `PARTIAL → VALIDATED`: sólo con fixture congelado (revision/fingerprint),
  import real en la máquina/software, readback expected vs actual y sign-off
  del operador en entorno no productivo (mismo estándar que #348).
- `VALIDATED → UNSUPPORTED`: si la evidencia demuestra incompatibilidad; el
  resultado negativo también es entregable y alimenta goldens/limitaciones.

## Fuera de alcance de este pack (permanente hasta issues propias)

- implementación de adapters (MPR/CADmatic/G-code) — #351;
- ejecución de corte o CNC productivo — #348/#306 con aprobación del taller;
- claims de soporte por marca — prohibido por contrato §10;
- superficie React de perfiles/evidencia — #503;
- generalizar cualquier resultado a Client B — #353.
