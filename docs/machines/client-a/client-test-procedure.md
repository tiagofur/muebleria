# Procedimiento de prueba — paquete de validación Granete para Client A

> Runbook para el operador/contacto del taller. Genera el paquete con:
>
> ```bash
> PTX_EMIT_CLIENT_PACK_DIR=/tmp/client-a-pack \
>   pnpm -C packages/excel exec vitest run machines/clientPack.test.ts -t emits
> ```
>
> **Regla absoluta: NON-PRODUCTION VALIDATION ARTIFACT. NO ejecutar corte ni
> mecanizado productivo.** Todo el contenido es sintético (`fixture-*`).

## Qué contiene el paquete

```text
README.txt                  ← banners, checksums, estado por archivo
test-generic.ptx            ← el único archivo generable hoy (perfil ptx-generic r1)
test-generic.manifest.json  ← provenance exacta: fixture, perfil, adapter, digests
```

Los objetivos `test-cadmatic3/4/5`, `test-hpp250` (SAW) y `test-bhx050` (MPR)
**no se generan** hasta existir evidencia de formato real (un archivo ejemplo
del software del cliente o especificación). El README del paquete lista
exactamente qué evidencia falta para cada uno.

## Procedimiento — corte (PTX)

1. Copiar el paquete al equipo del software receptor por el medio usual del
   taller. No modificar los archivos.
2. Importar/abrir `test-generic.ptx` en el software receptor.
3. Registrar si el parser lo acepta (sí/no + pantallazo sanitizado).
4. Intentar la **conversión a archivos de máquina** (el paso que falló con el
   PTX real — ver [`ptx-conversion-failure.md`](./ptx-conversion-failure.md)).
5. **NO ejecutar corte.**
6. Capturar el resultado exacto: mensaje de error **verbatim** o confirmación
   de éxito (pantallazos sin datos de cliente).
7. Capturar readback: lista de piezas con medidas/cantidades/materiales tal
   como las muestra el software (export del software > pantallazo).
8. Enviar de vuelta: resultados por archivo + versión EXACTA del software
   receptor (About/Help > versión + build).

## Procedimiento — cuando lleguen archivos CADmatic/SAW/MPR

Granete enviará variantes adicionales (`test-cadmatic3/4/5.ptx`,
`test-hpp250.saw`, `test-bhx050.mpr`) sólo cuando exista evidencia de formato.
El mismo procedimiento aplica por archivo: import → convertir → capturar error
verbatim / readback → sin ejecutar máquina.

## Qué necesitamos del cliente (evidencia pendiente)

| Evidencia | Habilita |
|---|---|
| Mensaje de error verbatim del fallo de conversión + versión exacta del software | Diagnóstico del REAL_FIELD_RED |
| Un archivo de ejemplo aceptado por su workflow (PTX o nativo) y/o export del software | Publicar revisiones evidenciadas de `ptx-cadmatic-*` |
| Un archivo `.saw` real aceptado por su workflow | Publicar `saw-homag` r2 evidenciado |
| Un archivo `.mpr` real producido por su woodWOP + versión exacta | Publicar `mpr-woodwop` evidenciado |
| Confirmación de máquina/controlador/versión (dossier §2) | MachineProfile completo |

## Sanitización de la respuesta

Sin nombres de personas/cliente, sin paths de red, sin hostnames/IPs, sin
precios, sin proyectos reales. Renombrar capturas; revisar metadatos antes de
adjuntar. La correspondencia client-a ↔ identidad real vive fuera del repo.
