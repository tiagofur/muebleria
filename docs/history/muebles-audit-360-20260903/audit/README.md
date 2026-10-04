# Portal de auditoría Granete 360°

**Alcance temporal: este informe audita 316df57c. El readback posterior de main es 0eb53be6 (merge PR550/#394); esos cambios NO fueron auditados ni incorporados. Las conclusiones describen el snapshot, no el main actual.**

Abrí `index.html` directamente en un navegador. La implementación no necesita conexión, servidor, instalación ni una cuenta para consultar los registros. La apertura real mediante file:// queda NEEDS VERIFICATION: la política del navegador de herramientas bloqueó esa URL. Las comprobaciones de interacción se ejecutaron mediante HTTP en localhost; podés abrir el archivo manualmente para verificar el modo directo. Los enlaces a GitHub sí requieren conexión y acceso al repositorio.

## Recorrido recomendado

1. Consultá **Resumen ejecutivo**, **MVP y scorecard** y **Demo playbook**.
2. Revisá **Hallazgos** por severidad. Expandí cada fila para leer evidencia, límites y recomendaciones completas.
3. Usá **Cobertura y UNKNOWN** para identificar lo que todavía no está probado.

## Navegación y trazabilidad

- Cada sección permite buscar en todos los campos, filtrar por severidad, fuente/módulo y estado, y ordenar por nombre o severidad.
- La navegación y los enlaces a registros usan anclas: podés copiar la dirección del navegador para volver al mismo lugar.
- Los filtros se conservan por sección durante la sesión del navegador.
- **Copiar registro y referencias** copia los datos completos del registro, no solo el resumen.
- **Imprimir sección** incluye todos los campos de los registros visibles con los filtros actuales. Seleccioná guardar como PDF en el navegador si necesitás compartir una selección.
- **Datos completos** conserva todas las estructuras originales, incluso campos nuevos sin una sección dedicada.
- Los enlaces de código apuntan al SHA auditado `316df57c7c3c9d5470b5a3f22b39fffeacfd7676`, no a un `main` cambiante.

## Actualizar el paquete de datos

Después de cambios en los JSON, regenerá en este orden: `python3 scripts/refresh_closeout.py`, `python3 scripts/check_coverage.py`, `node scripts/check_record_engine.mjs`, `python3 scripts/bundle.py` y `python3 scripts/check_portal.py`. Repetí `python3 scripts/bundle.py` al final para incluir los reportes de QA actualizados. Recargá el navegador. El script solo lee datos del reporte y escribe `data/bundle.js`; no toca el producto. Los archivos de evidencia se indexan sin inferir que un log representa una prueba exitosa.

## Interpretación correcta

Un conteo es un inventario, **no una medida de preparación**. Los estados históricos del ledger no prueban un flujo completo. `UNKNOWN / NEEDS VERIFICATION` indica evidencia faltante, no una función implementada ni una ausencia confirmada. No se calcula una puntuación global artificial. Consultá la rúbrica explícita del scorecard cuando esté disponible.

Las secciones sin datos permanecen visibles y declaran el faltante. La existencia de una sección en el portal no significa que la auditoría de esa sección esté terminada.

## Límite de QA

Las verificaciones del normalizador ejecutan sólo el código del reporte contra sus JSON: comprueban deduplicación y conteos, no comportamiento del producto. La última interacción del portal sigue limitada por el error interno del navegador de herramientas; la QA interactiva anterior no se extrapola a los mappings posteriores.
