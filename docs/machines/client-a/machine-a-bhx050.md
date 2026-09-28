# Dossier `machine-a` — WEEKE BHX 050 (client-a)

> Estado de validación: **`NOT_TESTED`**. Dossier de descubrimiento (#352).
> Procedencia de valores: `OWNER_CONFIRMED` (modelo/familia provistos por el
> owner de Granete), `FIELD_VERIFICATION_REQUIRED` (pendiente de evidencia de
> campo), `PUBLIC_REFERENCE_ONLY` (documentación pública; nunca validación).
> Base estructural: [`docs/templates/machine-dossier-template.md`](../../templates/machine-dossier-template.md).
> Checklist de recolección: [`intake-checklist.md`](./intake-checklist.md).

## B1. Estado del contrato y matriz de evidencia

**Decisión actual:** la identidad WEEKE/HOMAG BHX 050 está confirmada por el
owner a partir del cliente, pero no hay contrato del receptor ni capacidades
equipadas confirmadas. `CONFIRMED_CLIENT` se limita a esa identidad reportada;
la placa sanitizada sigue pendiente y la procedencia original `OWNER_CONFIRMED`
de §1 no se convierte en prueba de campo. `PUBLIC_REFERENCE_ONLY` describe
productos de HOMAG, nunca esta instalación. `UNKNOWN_FIELD_REQUIRED` bloquea
solamente el consumidor que necesita el dato; ninguna ausencia se rellena por
semejanza de modelo.

| field | source | status | required_for | blocker |
|---|---|---|---|---|
| Familia y modelo BHX 050 | Confirmación del owner desde Client A (§1); placa pendiente | `CONFIRMED_CLIENT` | Identidad del dossier | No autoriza capacidades ni compatibilidad física |
| Producto woodWOP | [HOMAG woodWOP](https://www.homag.com/en/product-detail/software/work-preparation/cnc-programming-software-woodwop) | `PUBLIC_REFERENCE_ONLY` | Preguntas sobre software y operaciones | No identifica la versión instalada ni la gramática aceptada |
| Variante de almacenamiento MPRXE | [HOMAG MPRXE](https://docs.homag.cloud/docs/en/neues-speicherformat-mprxe) | `PUBLIC_REFERENCE_ONLY` | Comparación de variantes, no selección | No demuestra que este receptor admita MPRXE, MPRX o MPR |
| Controlador y versión/build exactos | Ninguna captura de placa/pantalla (§2; [checklist](./intake-checklist.md)) | `UNKNOWN_FIELD_REQUIRED` | Revisión del perfil de instalación, import/readback | Perfil operativo exacto no identificable |
| Software de máquina y versión/build exactos | Ninguna captura de versión (§2; [checklist](./intake-checklist.md)) | `UNKNOWN_FIELD_REQUIRED` | Perfil de compatibilidad y receptor OEM | No asociar una muestra a la versión instalada |
| Formato nativo aceptado, versión y gramática/macros | Ningún programa aceptado y sanitizado ni especificación primaria aplicable (§3) | `UNKNOWN_FIELD_REQUIRED` | Adapter nativo y lector independiente | `NATIVE_FORMAT_RECEIVER_NOT_CONFIRMED`; no emitir MPR/MPRX/MPRXE |
| Encoding, decimales y fin de línea | Ninguna muestra aceptada de bytes (§3) | `UNKNOWN_FIELD_REQUIRED` | Serialización exacta | Bytes no verificables para el receptor |
| Unidades | Sin readback del programa aceptado (§3) | `UNKNOWN_FIELD_REQUIRED` | Escala de coordenadas y profundidad nativas | No convertir milímetros a unidades del receptor por suposición |
| Ejes, signos y origen | Sin programa/readback que localice puntos y direcciones (§3–§4.2) | `UNKNOWN_FIELD_REQUIRED` | Transformación montaje→marco nativo | Mapeo geométrico nativo bloqueado |
| Caras accesibles y convención de carga | Sin confirmación del operador ni readback (§3–§4.3) | `UNKNOWN_FIELD_REQUIRED` | Asignación de operaciones a montajes | Ninguna cara se declara mecanizable por el nombre BHX |
| Herramientas equipadas, IDs y alcances | Sin captura de configuración del cabezal (§4.3–§4.5) | `UNKNOWN_FIELD_REQUIRED` | Selección/validación de operación | Diámetro, profundidad, ranurado y fresado no habilitados |
| Pinzas y zonas de exclusión | Sin configuración de sujeción (§4.6) | `UNKNOWN_FIELD_REQUIRED` | Validación de accesibilidad y holgura | No declarar montaje seguro ni calcular zonas libres |
| Límites de tamaño y espesor | Sin límites de esta instalación (§4.6) | `UNKNOWN_FIELD_REQUIRED` | Preflight físico de pieza | No aceptar dimensiones por fichas de otra generación |
| Reorientación y montajes múltiples | Sin procedimiento del operador ni muestra/readback (§4.2, §4.7) | `UNKNOWN_FIELD_REQUIRED` | Plan físico de varias caras | Cara no accesible exige montaje confirmado o bloqueo |
| Transferencia, selección y etiqueta | Sin flujo sanitizado del operador (§4.1, §4.7) | `UNKNOWN_FIELD_REQUIRED` | B3 entrega/importación y vínculo a pieza | Sin escritura automática ni claim de ejecución |
| Nombres de archivo y referencias externas | Sin muestra aceptada que cubra ambos (§3) | `UNKNOWN_FIELD_REQUIRED` | Manifest y programa nativo | No fijar 8.3, truncado o subprogramas por intuición |

**Frontera B2:** una foundation neutral puede avanzar con operaciones y fixtures
sintéticos explícitos, transformaciones y cobertura que bloqueen lo no
soportado. No puede producir un programa nativo ni afirmar compatibilidad BHX.
El [perfil BHX](../../../packages/excel/src/machines/profiles.ts) declara cero
capabilities y el perfil MPR no tiene dimensiones evidenciadas; el
[adapter MPR](../../../packages/excel/src/machines/woodWopMprAdapter.ts) devuelve
`SERIALIZER_NOT_IMPLEMENTED`. La proyección 2D/heurística por nombre de
[`partDrilling.ts`](../../../packages/domain/src/partDrilling.ts) tampoco es
verdad CNC. `NATIVE_FORMAT_RECEIVER_NOT_CONFIRMED` es un bloqueo del plan B1/B2,
no un código de error ya implementado. La importación/readback y la prueba
física permanecen bajo #352 y en estado `NOT_TESTED`.

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
perfil de identidad `machine-a` actual no declara capabilities; una revisión
operativa que las habilite requiere estos valores confirmados en campo.

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

## 5. Referencias oficiales — `PUBLIC_REFERENCE_ONLY`

> Estas referencias describen la **familia** de producto, no esta máquina
> concreta. Pueden orientar las preguntas del checklist pero **jamás** llenan
> los campos de §1–§4 ni promueven el estado `NOT_TESTED`.

- [HOMAG woodWOP](https://www.homag.com/en/product-detail/software/work-preparation/cnc-programming-software-woodwop)
  describe programación visual de perforaciones y otras operaciones, con
  simulación woodMotion opcional. No aporta la gramática ni acredita la versión
  o las opciones instaladas en Client A.
- [HOMAG MPRXE](https://docs.homag.cloud/docs/en/neues-speicherformat-mprxe)
  describe una variante de almacenamiento. Su existencia no demuestra que
  `machine-a` admita MPRXE, MPRX o MPR. woodWOP/MPR sigue siendo un objetivo a
  contrastar, no un formato confirmado; no escoger la variante por novedad.

## 6. Fixture de validación futura — documentado, NO implementado en B1

> Primer fixture de validación segura. #879 B2 puede implementar sólo la
> foundation offline neutral con datos sintéticos explícitos. El adapter
> nativo y el readback de esta instalación requieren antes el contrato exacto
> del receptor; la validación de campo sigue en #352.

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
- B2 puede probar operaciones neutrales sintéticas sin snapshot liberado de
  cliente; la salida productiva sigue requiriendo release y perfil exactos.

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
