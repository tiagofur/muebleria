# Evidencia — fallo de conversión PTX en Client A (REAL_FIELD_RED)

> **Registro de evidencia de campo (#348/#352).** Este archivo registra un
> fallo REAL observado en el software del cliente. No es una hipótesis de
> incompatibilidad teórica: **CURRENT GRANETE PTX = NOT VALIDATED** y este
> evento es el objetivo de regresión del lane de machine-output.

## 1. Evento

| Campo | Valor |
|---|---|
| `opaqueClientKey` | `client-a` |
| Máquina implicada | `machine-b` (HOLZMA HPP 250, sierra de formato) — ver nota §4 |
| Fecha del envío | ~2026-09-04 (relato del owner: "hace aproximadamente dos días" al 2026-09-06) |
| Qué se envió | Un PTX generado por Granete (proyecto real del cliente) |
| Resultado observado | El software receptor **alcanzó el workflow de conversión** y **FALLÓ al intentar convertir el PTX en archivos de máquina** |
| Fuente del relato | Owner de Granete (relay), 2026-09-06 |

## 2. Clasificación

```text
REAL_FIELD_RED
```

- El archivo fue **aceptado como entrada** lo suficiente para llegar al paso
  de conversión (parsing/import inicial superado o al menos invocado).
- La **conversión a archivos de máquina falló**. Hasta tener el mensaje exacto,
  la causa (sintaxis de registros, campos obligatorios, encoding, versión del
  dialecto PTX esperado, semántica de kerf/trim, identidad de tablero) es
  `FIELD_VERIFICATION_REQUIRED`.
- No se ejecutó corte. No hubo daño ni material comprometido.

## 3. Artefacto fallido

El PTX enviado provenía de un proyecto real del cliente y **no se commitea a
este repositorio** (regla de sanitización). Su checksum exacto no fue capturado
antes del envío — acción corregida por el paquete de validación (§5), que fija
SHA-256 por artefacto ANTES de salir del repo.

Generador presumido: `packages/excel/src/ptxCutPlanExport.ts` con perfil
`ptx-generic` r1 (dialeto definido en-repo; auditoría completa en
[`../ptx-validation.md`](../ptx-validation.md)).

## 4. Incertidumbre explícita

- La máquina/software exactos que recibieron el archivo son
  `FIELD_VERIFICATION_REQUIRED` (¿CADmatic? ¿versión?). No asumir que fue el
  HPP 250 ni CADmatic hasta confirmación de campo.
- Mensaje de error exacto: `FIELD_VERIFICATION_REQUIRED` (capturar verbatim,
  con captura sanitizada, en la próxima corrida).

## 5. Respuesta implementada (2026-09-06)

1. **Kit de reproducción/diagnóstico congelado:** fixture sintético
   `fixture-board-001` r1 + golden PTX con SHA-256
   (`docs/machines/ptx-validation.md` §5) — el mismo archivo que el paquete de
   validación envía al cliente, sin datos reales.
2. **Arquitectura de salida versionada (#351 foundation):** un adapter PTX +
   perfiles de compatibilidad versionados (`ptx-generic`, `ptx-cadmatic-3/4/5`,
   `saw-homag`, `mpr-woodwop`) que **fallan cerrado** sin evidencia de formato.
   La evidencia que el cliente devuelva publica revisiones nuevas de perfil —
   nunca adivina sintaxis en el serializador.
3. **Paquete de validación sanitizado** (`buildClientValidationPack`) con
   banner NON-PRODUCTION y checksums por archivo; procedimiento en
   [`client-test-procedure.md`](./client-test-procedure.md).

## 6. Cierre de este hallazgo

Este registro pasa a estado resuelto sólo cuando:

- [ ] el software/máquina/versión exactos del receptor quedan documentados con evidencia de campo;
- [ ] se captura el mensaje de error verbatim (sanitizado);
- [ ] una revisión evidenciada del perfil correspondiente produce un PTX que el
      receptor convierte sin error (o el hallazgo se clasifica `UNSUPPORTED`
      para esa combinación exacta);
- [ ] el readback estructurado (`docs/machines/ptx-validation.md` §6–§7) se
      completa y el operador firma.
