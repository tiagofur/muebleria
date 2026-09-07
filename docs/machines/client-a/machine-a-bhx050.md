# Dossier `machine-a` — WEEKE BHX 050 (client-a)

> Estado de validación: **`NOT_TESTED`**. Dossier de descubrimiento (#352).
> Procedencia de valores: `OWNER_CONFIRMED` (modelo/familia provistos por el
> owner de Granete), `FIELD_VERIFICATION_REQUIRED` (pendiente de evidencia de
> campo), `PUBLIC_REFERENCE_ONLY` (documentación pública; nunca validación).
> Base estructural: [`docs/templates/machine-dossier-template.md`](../../templates/machine-dossier-template.md).
> Checklist de recolección: [`intake-checklist.md`](./intake-checklist.md).

## 1. Identidad de la máquina

| Campo | Valor | Procedencia |
|---|---|---|
| `opaqueClientKey` | `client-a` | fijo por sanitización |
| `machineKey` | `machine-a` | fijo por sanitización |
| `manufacturer` | WEEKE (familia HOMAG) | `OWNER_CONFIRMED` |
| `model` | BHX 050 | `OWNER_CONFIRMED` |
| `modelVariant` | `FIELD_VERIFICATION_REQUIRED` | missing |
| `serialVariant` | `FIELD_VERIFICATION_REQUIRED` (usar código interno si el taller considera sensible el número de serie) | missing |
| `manufactureYear` | `FIELD_VERIFICATION_REQUIRED` | missing |
| `machineRole` | centro de mecanizado/perforación CNC de panel | `OWNER_CONFIRMED` |

Evidencia mínima para cerrar identidad: foto de placa de identificación de la
máquina (sanitizada), confirmación de operador.

## 2. Control y software

Control y software se capturan **independientes**; nunca se combinan en un
valor adivinado.

| Campo | Valor | Procedencia |
|---|---|---|
| `controller` | `FIELD_VERIFICATION_REQUIRED` | missing |
| `controllerVersion` | `FIELD_VERIFICATION_REQUIRED` (versión exacta + build) | missing |
| `machineSoftware` | `FIELD_VERIFICATION_REQUIRED` | missing |
| `machineSoftwareVersion` | `FIELD_VERIFICATION_REQUIRED` (versión exacta + build) | missing |
| `optimizationSoftware` | `FIELD_VERIFICATION_REQUIRED` | missing |
| `optimizationSoftwareVersion` | `FIELD_VERIFICATION_REQUIRED` | missing |
| `operatingEnvironment` | `FIELD_VERIFICATION_REQUIRED` (SO/entorno del equipo de control; sin hostnames ni IPs) | missing |

Regla (#351): **versiones de software distintas ⇒ perfiles distintos.** El
`MachineProfile` de `machine-a` sólo puede publicarse con estos valores
confirmados en campo.

## 3. Contrato de entrada/salida

| Campo | Valor | Procedencia |
|---|---|---|
| `acceptedInputFormats` | `FIELD_VERIFICATION_REQUIRED` (formato(s) que el software de esta máquina importa realmente) | missing |
| `producedOutputFormats` | `FIELD_VERIFICATION_REQUIRED` (p. ej. exports/readbacks que el equipo produce) | missing |
| `fileExtension` | `FIELD_VERIFICATION_REQUIRED` | missing |
| `fileFormatVersion` | `FIELD_VERIFICATION_REQUIRED` | missing |
| `encoding` | `FIELD_VERIFICATION_REQUIRED` | missing |
| `units` | `FIELD_VERIFICATION_REQUIRED` | missing |
| `coordinateConvention` | `FIELD_VERIFICATION_REQUIRED` | missing |
| `workpieceOrigin` | `FIELD_VERIFICATION_REQUIRED` | missing |
| `faceConvention` | `FIELD_VERIFICATION_REQUIRED` (convención de cara buena/visible y de caras perforables) | missing |
| `axisConvention` | `FIELD_VERIFICATION_REQUIRED` | missing |

Nota: la familia de formatos sugerida por referencias públicas (§6) es
sólo `PUBLIC_REFERENCE_ONLY`; el formato aceptado real por esta máquina/versión
se confirma con un sample job (§7).

## 4. Matriz de descubrimiento BHX 050

Ninguna capability se da por existente por ser propia de máquinas BHX 050 en
general (contrato §10: capabilities no se infieren por marca). Cada fila se
cierra con evidencia: `CLIENT_CONFIRMED` (foto/archivo/readback/operador) o
queda `FIELD_VERIFICATION_REQUIRED`.

### 4.1 Control, programas y transferencia

| Campo | Valor | Procedencia |
|---|---|---|
| `controller` (detalle de operación diaria) | `FIELD_VERIFICATION_REQUIRED` | missing |
| Software/versión exacta (p. ej. family woodWOP — **sólo confirmar, no asumir**) | `FIELD_VERIFICATION_REQUIRED` | missing |
| Formato de programa aceptado (p. ej. MPR — **sólo confirmar, no asumir**) y versión del formato | `FIELD_VERIFICATION_REQUIRED` | missing |
| Método de importación de programas | `FIELD_VERIFICATION_REQUIRED` (USB / red / carpeta vigilada / nube — sin shares ni paths privados) | missing |
| Método de transferencia de archivos (red/archivo) | `FIELD_VERIFICATION_REQUIRED` | missing |
| Comportamiento de cola de trabajos (job queue) | `FIELD_VERIFICATION_REQUIRED` (cómo se encolan/priorizan/reemplazan trabajos) | missing |

### 4.2 Geometría y convenciones

| Campo | Valor | Procedencia |
|---|---|---|
| Orientación de la pieza | `FIELD_VERIFICATION_REQUIRED` (cómo entra la pieza a la máquina y qué cara mira a quién) | missing |
| Origen de pieza (workpiece origin) | `FIELD_VERIFICATION_REQUIRED` | missing |
| Unidades | `FIELD_VERIFICATION_REQUIRED` | missing |

### 4.3 Perforación

| Campo | Valor | Procedencia |
|---|---|---|
| Perforación vertical — soporte y patrón | `FIELD_VERIFICATION_REQUIRED` (ejes disponibles, número de husillos por eje) | missing |
| Perforación horizontal X — soporte | `FIELD_VERIFICATION_REQUIRED` | missing |
| Perforación horizontal Y — soporte | `FIELD_VERIFICATION_REQUIRED` | missing |
| Configuración de cabezal de perforación | `FIELD_VERIFICATION_REQUIRED` (nº de husillos, posiciones, paso entre husillos/matriz) | missing |
| Diámetros de broca disponibles | `FIELD_VERIFICATION_REQUIRED` | missing |
| IDs de herramienta de perforación | `FIELD_VERIFICATION_REQUIRED` (mapa herramienta↔ID real del taller) | missing |
| Profundidad máxima de perforación | `FIELD_VERIFICATION_REQUIRED` (mm) | missing |

### 4.4 Ranurado (grooving)

| Campo | Valor | Procedencia |
|---|---|---|
| Soporte de ranurado | `FIELD_VERIFICATION_REQUIRED` | missing |
| Herramientas de ranurado | `FIELD_VERIFICATION_REQUIRED` | missing |
| Orientación de ranura soportada | `FIELD_VERIFICATION_REQUIRED` (cara/eje/dirección) | missing |

### 4.5 Fresado (routing) — sólo si el equipo lo confirma

| Campo | Valor | Procedencia |
|---|---|---|
| Soporte de fresado | `FIELD_VERIFICATION_REQUIRED` (no asumir que la máquina lo trae equipado) | missing |
| Configuración de router/husillo (si equipado) | `FIELD_VERIFICATION_REQUIRED` (potencia, rango, portaherramienta) | missing |

### 4.6 Sujeción y límites físicos

| Campo | Valor | Procedencia |
|---|---|---|
| Restricciones de pinza/apriete (clamps) | `FIELD_VERIFICATION_REQUIRED` (zonas válidas, zonas prohibidas) | missing |
| Dimensiones mínimas de pieza | `FIELD_VERIFICATION_REQUIRED` (mm) | missing |
| Dimensiones máximas de pieza | `FIELD_VERIFICATION_REQUIRED` (mm) | missing |
| Límites de espesor | `FIELD_VERIFICATION_REQUIRED` (mm) | missing |

### 4.7 Identificación y flujo del operador

| Campo | Valor | Procedencia |
|---|---|---|
| Soporte de código de barras | `FIELD_VERIFICATION_REQUIRED` (lector presente/no presente, qué codifica) | missing |
| Identificación de trabajo/etiqueta | `FIELD_VERIFICATION_REQUIRED` (cómo identifica la máquina el trabajo y la pieza) | missing |
| Flujo de trabajo del operador | `FIELD_VERIFICATION_REQUIRED` (desde que llega el trabajo hasta que la pieza sale) | missing |

Al confirmarse capacidades, se traducen a `MachineCapability` con constraints
en mm (`granete.drilling`, `granete.panel-geometry` como semillas vigentes) —
sin infierir nada por marca.

## 5. Referencias públicas — `PUBLIC_REFERENCE_ONLY`

> Estas referencias describen la **familia** de producto, no esta máquina
> concreta. Pueden orientar las preguntas del checklist pero **jamás** llenan
> los campos de §1–§4 ni promueven el estado `NOT_TESTED`. Se excluyen
> afirmaciones de revendedores como peso de validación.

- El BHX 050 es un centro de mecanizado CNC **vertical** compacto para piezas
  de panel de la familia HOMAG (ex-WEEKE); datos técnicos de terceros de 2017
  mencionan longitudes de pieza de trabajo de 200–2.500 mm y ancho desde
  70 mm — [WOOD TEC PEDIA: HOMAG BHX 050](https://wtp.hoechsmann.com/en/lexikon/34303/homag_bhx_050).
- La programación de la serie BHX se asocia a la familia **woodWOP** de HOMAG
  (foro de fabricante discute programación woodWOP para la serie) —
  [HOMAG Forum](https://forum.homag.com/forum/index.php?thread/10500-bhx-500-programming-solutions/)
  y [HOMAG — WEEKE brand](https://www.homag.com/en/weeke).
- Implicación sólo orientativa: el checklist debe confirmar versión exacta de
  woodWOP/software de control y el formato de programa aceptado (p. ej. MPR)
  **de esta máquina**. Cualquier similitud con lo público no es evidencia.

## 6. Fixture de validación futura — documentado, NO implementado

> Primer fixture de validación segura. Se documenta aquí por #352; su
> implementación (adapter + artifact + readback) pertenece a #351/#348 y
> permanece bloqueada.

Fixture propuesto: `fixture-bhx050-v1` (nombre se congela con
revision/fingerprint al implementarse).

```text
tablero sintético de dimensiones conocidas
+ UN patrón de perforación vertical
+ UNA perforación horizontal, SÓLO donde el dossier confirme soporte (§4.3)
+ UNA ranura, SÓLO donde el dossier confirme soporte (§4.4)
+ fresado opcional, SÓLO si la configuración de la máquina lo confirma (§4.5)
```

Flujo esperado (no implementado):

```text
ManufacturingFeatures de Granete (verdad resuelta y liberada)
→ MachineProfile revision (machine-a, control/software/versión exactos)
→ PostprocessorAdapter version/digest (un adapter por formato aceptado)
→ artifact de máquina (manifest §12)
→ import en la máquina/software
→ readback: comparar esperado vs obtenido
→ sign-off del operador en entorno seguro/no productivo
```

Restricciones:

- ninguna pieza de cliente real es requerida ni usada para la validación
  inicial (usar `sample-job-001` sintético);
- el import no es éxito sólo porque el archivo abre: el readback verifica
  unidades, cantidades, dimensiones, orientación y parámetros (estándar #348);
- sin adapter MPR/woodWOP implementado en este PR.

## 7. Sign-off del operador (para #348, cuando corresponda)

| Campo | Valor |
|---|---|
| Rol del operador que valida (sin nombre real en el repo) | |
| Fecha de la validación | |
| Qué validó exactamente (import + readback + simulación / pieza de prueba) | |
| Entorno (no productivo / productivo) | |

## 8. Notas de taller

(vacío — errores frecuentes del software, workarounds, formato usado día a día,
quién programa la máquina; siempre sanitizado)
