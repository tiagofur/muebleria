# Plantilla — Paquete de evidencia PTX import/readback (#348)

> Un paquete = una combinación exacta máquina/controlador/software/versión +
> una revisión del fixture. Completar sólo lo observado; lo no verificable se
> marca `NOT_OBSERVABLE` o `FIELD_VERIFICATION_REQUIRED` — nunca se infiere ni
> se estima.
>
> **Sanitización obligatoria antes de que el dato entre al repo**
> (`docs/machines/README.md`): sin nombres de clientes/personas, emails,
> direcciones, precios, credenciales, hostnames, IPs, paths privados ni
> nombres reales de proyecto o archivo de producción.

## 1. Identidad del paquete

| Campo | Valor |
|---|---|
| `evidencePackId` (ej. `evidence-client-a-machine-b-r1-20260912`) | |
| `opaqueClientKey` | `client-a` |
| `machineKey` | `machine-b` |
| Fixture | `fixture-board-001` revisión `r1` |
| Fecha de la corrida | |

## 2. Combinación exacta bajo prueba

| Campo | Valor | Procedencia |
|---|---|---|
| Máquina (fabricante/modelo/variante) | | |
| Controlador + versión EXACTA (build) | | |
| Software receptor + versión EXACTA | | |
| Medio de transferencia (USB/red taller — sin datos de red) | | |
| Módulos/licencias del software relevantes al import | | |

Regla: versiones distintas ⇒ paquete distinto (nunca se reinterpretan en silencio).

## 3. Artefactos y procedencia

| Campo | Valor |
|---|---|
| Granete commit SHA que produjo el golden | |
| Rama/PR de Granete | |
| `fixture-board-001.ptx` SHA-256 | |
| Fixture revision (`r1`) | |
| ¿Golden commiteado o emitido en sitio? | |

## 4. Resultado de la comparación

| Campo | Valor |
|---|---|
| `ptx-readback-comparison.json` adjunto (sí/no) | |
| `blockerCount` | |
| `warningCount` (cada warning: resuelto/escalado + cómo) | |
| `unsupportedCount` (campos no transportados por PTX) | |
| `notObservableCount` (campos no expuestos por el receptor) | |
| `passCount` | |

Clasificación de cada diferencia distinta de `PASS` (usar §7 de
`docs/machines/ptx-validation.md`): tabla campo → clase → decisión humana.

## 5. Readback capturado

| Campo | Valor |
|---|---|
| Medio de captura (reporte/export/pantalla/foto sanitizada) | |
| `fixture-board-001.actual.json` adjunto (sí/no) | |
| Campos que el receptor NO expone | |
| Observaciones del operador (texto libre, sanitizado) | |

## 6. Operator sign-off

| Campo | Valor |
|---|---|
| Rol del firmante (sin nombre real) | |
| ¿Entorno no productivo? (sí/no) | |
| ¿Se ejecutó corte real? (debe ser **no**) | |
| El operador confirma qué leyó el software (sí/no + notas) | |
| Limitaciones declaradas por el operador | |
| Checklist de dossier aplicado (`machine-dossier-template.md` §7) | |

## 7. Estado resultante (una sola opción)

| Estado | Significado |
|---|---|
| `NOT_TESTED` | sin evidencia suficiente aún |
| `PARTIAL` | import/readback incompleto; exige este pack |
| `VALIDATED` | import + readback + sign-off para ESTA versión exacta |
| `UNSUPPORTED` | la evidencia demuestra incompatibilidad |

Alcance del claim: **sólo** esta combinación de §2 con esta revisión de §1.
No se extrapola a otras versiones, máquinas, clientes ni a datos de producción.

## 8. Limitaciones conocidas y siguientes pasos

- (listar, ej. warnings sin resolver, campos `UNKNOWN_FORMAT_CAPABILITY`)
