# Pack de máquinas — client-b

> **Sanitización aplicada**: sin nombre real de cliente, sin número de serie,
> sin paths de red, sin datos de empleados. La correspondencia entre `client-b`
> y la identidad real vive fuera del repositorio.

## Máquinas

| ID interno | Modelo | Estado |
|------------|--------|--------|
| `machine-c` | KDT Flexdrill 1200 (línea de perforación horizontal) | `NOT_TESTED` — dossier de descubrimiento |

---

## Dossiers

- [`machine-c-kdt-flexdrill1200.md`](./machine-c-kdt-flexdrill1200.md) —
  KDT Flexdrill 1200, formato XML `KDTPanelFormat` exportado desde Promob Studio.

## Muestras de archivo

- [`samples/`](./samples/) — 417 archivos XML de producción real,
  sanitizados (sin metadatos de cliente). Representan una corrida de
  producción completa con 9 tipos de piezas. Ver
  [`../kdt-xml-format.md`](../kdt-xml-format.md) para la especificación
  completa del formato.
