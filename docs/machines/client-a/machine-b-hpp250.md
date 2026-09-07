# Dossier `machine-b` — HOLZMA HPP 250 (client-a)

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
| `machineKey` | `machine-b` | fijo por sanitización |
| `manufacturer` | HOLZMA (familia HOMAG) | `OWNER_CONFIRMED` |
| `model` | HPP 250 | `OWNER_CONFIRMED` |
| `modelVariant` | `FIELD_VERIFICATION_REQUIRED` (longitud de corte configurada, carga frontal/otra) | missing |
| `serialVariant` | `FIELD_VERIFICATION_REQUIRED` (usar código interno si el taller considera sensible el número de serie) | missing |
| `manufactureYear` | `FIELD_VERIFICATION_REQUIRED` | missing |
| `machineRole` | sierra de formato (panel dividing / beam saw) | `OWNER_CONFIRMED` |

Regla física del repo aplicable: **corte trabaja piezas** — la unidad de
trabajo de esta máquina es la pieza (`docs/production-flow-v2.md`); la identidad
de pieza que sale de la sierra es la que consume el flujo posterior.

## 2. Control y software

| Campo | Valor | Procedencia |
|---|---|---|
| `controller` | `FIELD_VERIFICATION_REQUIRED` (confirmar familia CADmatic en esta máquina; **no asumir**) | missing |
| `controllerVersion` | `FIELD_VERIFICATION_REQUIRED` (versión CADmatic **exacta** + build) | missing |
| `machineSoftware` | `FIELD_VERIFICATION_REQUIRED` | missing |
| `machineSoftwareVersion` | `FIELD_VERIFICATION_REQUIRED` | missing |
| `optimizationSoftware` | `FIELD_VERIFICATION_REQUIRED` (qué usa hoy el taller para optimizar, si algo) | missing |
| `optimizationSoftwareVersion` | `FIELD_VERIFICATION_REQUIRED` (versión **exacta**) | missing |
| `operatingEnvironment` | `FIELD_VERIFICATION_REQUIRED` (sin hostnames ni IPs) | missing |

Regla (#351): **versiones de software distintas ⇒ perfiles distintos.**

## 3. Contrato de entrada/salida

| Campo | Valor | Procedencia |
|---|---|---|
| `acceptedInputFormats` | `FIELD_VERIFICATION_REQUIRED` (formato externo que esta CADmatic/versión acepta realmente) | missing |
| `producedOutputFormats` | `FIELD_VERIFICATION_REQUIRED` (reports/readbacks/etiquetas que produce) | missing |
| `fileExtension` | `FIELD_VERIFICATION_REQUIRED` | missing |
| `fileFormatVersion` | `FIELD_VERIFICATION_REQUIRED` | missing |
| `encoding` | `FIELD_VERIFICATION_REQUIRED` | missing |
| `units` | `FIELD_VERIFICATION_REQUIRED` | missing |
| `coordinateConvention` | `FIELD_VERIFICATION_REQUIRED` | missing |
| `workpieceOrigin` | `FIELD_VERIFICATION_REQUIRED` (referencia de origen del tablero/pieza) | missing |
| `faceConvention` | `FIELD_VERIFICATION_REQUIRED` (cara buena / dirección de veta) | missing |
| `axisConvention` | `FIELD_VERIFICATION_REQUIRED` | missing |

## 4. Matriz de descubrimiento HPP 250

| Campo | Valor | Procedencia |
|---|---|---|
| Controlador | `FIELD_VERIFICATION_REQUIRED` | missing |
| Versión CADmatic **exacta** | `FIELD_VERIFICATION_REQUIRED` | missing |
| Software de optimización y versión **exacta** | `FIELD_VERIFICATION_REQUIRED` | missing |
| Formato de entrada externo aceptado | `FIELD_VERIFICATION_REQUIRED` (con un archivo ejemplo real) | missing |
| Método de transferencia de red/archivo | `FIELD_VERIFICATION_REQUIRED` (USB / red / carpeta vigilada — sin shares ni paths privados) | missing |
| Identidad de tablero/material | `FIELD_VERIFICATION_REQUIRED` (cómo se identifica el tablero: material, espesor, veta) | missing |
| Dimensiones de tablero | `FIELD_VERIFICATION_REQUIRED` (mm) | missing |
| Dimensiones de pieza (mín/máx) | `FIELD_VERIFICATION_REQUIRED` (mm) | missing |
| Cantidades de pieza | `FIELD_VERIFICATION_REQUIRED` (cómo se expresan/repiten) | missing |
| Dirección de veta (grain) | `FIELD_VERIFICATION_REQUIRED` (cuándo aplica y cómo se respeta) | missing |
| Kerf (espesor de corte) | `FIELD_VERIFICATION_REQUIRED` (mm; quién lo define) | missing |
| Trim (recorte/despiece de bordes) | `FIELD_VERIFICATION_REQUIRED` (política y valores) | missing |
| Política de rotación de pieza | `FIELD_VERIFICATION_REQUIRED` (cuándo se permite rotar) | missing |
| Secuencia de corte | `FIELD_VERIFICATION_REQUIRED` (quién la decide y si puede leerse de vuelta) | missing |
| Impresora de etiquetas | `FIELD_VERIFICATION_REQUIRED` (presente o no; marca/modelo) | missing |
| Formato de etiqueta | `FIELD_VERIFICATION_REQUIRED` (layout real del taller) | missing |
| Código de barras | `FIELD_VERIFICATION_REQUIRED` (qué codifica; compatibilidad con el QR de pieza `muebles://` si aplicara) | missing |
| Campos de identidad de pieza en etiqueta | `FIELD_VERIFICATION_REQUIRED` (qué identifica la pieza río abajo) | missing |
| Identidad de pieza para CNC aguas abajo (BHX) | `FIELD_VERIFICATION_REQUIRED` (cómo la pieza que sale de la sierra llega identificada a `machine-a`) | missing |
| Ownership de optimización | ver §5 (pregunta arquitectónica abierta) | `FIELD_VERIFICATION_REQUIRED` |
| Ownership de nesting | ver §5 (pregunta arquitectónica abierta) | `FIELD_VERIFICATION_REQUIRED` |
| Flujo de trabajo del operador | `FIELD_VERIFICATION_REQUIRED` (desde la orden hasta el apilado de piezas cortadas) | missing |

## 5. Pregunta arquitectónica abierta — ownership de la optimización/plan de corte

> No se decide por suposición. Se documentan las alternativas y la evidencia
> de campo necesaria para elegir. El modelo existente (#351) **no** requiere
> conceptos nuevos para ninguna de las tres.

```text
¿Granete genera el plan de corte final, o CADmatic (y su software de
optimización) es dueño de la optimización final?
```

| Alternativa | Descripción | Consecuencia arquitectónica |
|---|---|---|
| A — CADmatic dueño de la optimización | Granete exporta la lista exacta de piezas liberadas (identidad, dimensiones, cantidades, veta); el software de la sierra hace el nesting/plan final. | Un adapter de **intercambio de piezas** (`PostprocessorAdapter` con `producedArtifacts` p. ej. `csv|dxf|other`); sin motor de corte en Granete para esta máquina. La identidad de pieza debe sobrevivir a la reordenación. |
| B — Granete dueño del plan de corte | Granete produce el plan completo (ya existe linaje de optimizer y goldens de cut plan en el repo) y la sierra ejecuta el programa importado sin re-optimizar. | Adapter que serializa un **programa de corte completo**; el readback compara plan esperado vs ejecutado. |
| C — Híbrido | Granete propone plan; CADmatic re-optimiza. | Requiere reglas de reconciliación readback (diferencias clasificadas blocker/warning) antes de cualquier claim `partial|validated`. Más costo: dejar como fallback, no como diseño por defecto. |

Evidencia de campo necesaria para decidir:

1. qué formato(s) de entrada externa acepta **esta** CADmatic/versión y con
   qué fidelidad (sólo piezas vs plan completo);
2. qué software de optimización usa el taller hoy y cómo fluye hacia la sierra
   (checklist §`intake-checklist.md` HPP ítem 6);
3. si el flujo del taller exige metas de rendimiento (yield) de Granete o
   libertad del operador/sierra;
4. si el pipeline de etiquetas permite conservar la identidad de pieza de
   Granete tras una reordenación de la sierra (requisito duro: la identidad
   exacta de pieza/revisión nunca depende de nombre ni índice de corte);
5. si existe readback de la secuencia de corte real.

Invariante en cualquier alternativa: la verdad de fabricación liberada por
Granete no se muta desde un import no verificado; la comparación
expected/actual gobierna, y las diferencias se clasifican (blocker / warning /
unsupported capability) — estándar #348.

## 6. Referencias públicas — `PUBLIC_REFERENCE_ONLY`

> Describen la familia de producto, no esta máquina concreta. No llenan
> §1–§4 ni promueven el estado `NOT_TESTED`. Se excluyen afirmaciones de
> revendedores como peso de validación.

- La HPP 250 es una sierra de formato (beam saw) compacta de carga frontal de
  la familia HOLZMA/HOMAG; datos técnicos de terceros mencionan longitudes de
  corte de 3.100 / 3.800 / 4.300 mm y proyección de disco de 80 mm (75 mm en
  modelos hasta 2013) —
  [WOOD TEC PEDIA: HOLZMA HPP 250](https://wtp.hoechsmann.com/en/lexikon/5543/holzma_hpp_250).
- La familia de control **CADmatic** es la asociada a las sierras de formato
  HOLZMA/HOMAG (generaciones como CADmatic 4 aparecen en documentación de
  modelos relacionados de la época) —
  [HOMAG — HOLZMA brand](https://www.homag.com/en/holzma).
- Implicación sólo orientativa: el checklist debe confirmar versión CADmatic
  exacta, software de optimización real del taller (ecosistema HOMAG u otro) y
  el formato de import aceptado **de esta máquina**. La presencia de
  impresora de etiquetas u otras opciones es configurable por máquina: no se
  asume.

## 7. Fixture de validación futura — documentado, NO implementado

Fixture propuesto: `fixture-hpp250-v1` (nombre se congela con
revision/fingerprint al implementarse).

```text
UN tablero sintético
+ pocas piezas sintéticas (2–4)
+ dimensiones y cantidades conocidas
+ dirección de veta donde aplique
+ IDs de pieza conocidos y etiquetas conocidas
```

Flujo esperado (no implementado):

```text
piezas exactas liberadas por Granete (ProductionRelease, revision/fingerprint)
→ frontera del plan de corte (según decisión de §5)
→ artifact/intercambio HPP/CADmatic (PostprocessorAdapter version/digest)
→ import/readback en el software de la sierra
→ comparación: dimensiones, cantidades, orden, etiquetas (expected vs actual)
→ sign-off del operador en entorno seguro/no productivo
```

Restricciones:

- sin corte productivo; pieza de prueba simple/desechable (`sample-job-001`);
- no se implementa generador CADmatic/optimizador de corte en este PR;
- el resultado (validated/partial/unsupported) queda explícito por
  máquina/software/versión y no se extiende a `client-b` (#353).

## 8. Sign-off del operador (para #348, cuando corresponda)

| Campo | Valor |
|---|---|
| Rol del operador que valida (sin nombre real en el repo) | |
| Fecha de la validación | |
| Qué validó exactamente (import + readback + simulación / corte de prueba seguro) | |
| Entorno (no productivo / productivo) | |

## 9. Notas de taller

(vacío — errores frecuentes, workarounds, formato usado día a día, quién
programa la sierra; siempre sanitizado)
