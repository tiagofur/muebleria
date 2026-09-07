# DEMO — referencias secundarias

**Este documento no es una segunda cola ni autoriza cambios de prioridad.**
GitHub Issues conserva las tareas; el [estado operativo](software-factory-status.md)
conserva gates y evidencia de la fábrica.

## Inventario existente, sin duplicación

El inventario detallado vigente es `SECONDARY_BACKLOG.md` del coordinador existente:
`/Users/tiagofur/Documents/Codex/2026-09-06/referenced-chatgpt-conversation-this-is-an/outputs/granete-factory/SECONDARY_BACKLOG.md`.
Este punto de entrada en el repositorio evita crear otra lista competidora. Antes
de trasladar ese inventario, reconciliar referencias y convertir el anterior en
un enlace, preservando los informes de evidencia completados.

## Regla de clasificación

- Blocker reproducido o requisito indispensable del golden path: reutilizar issue
  existente o crear una con formulario, evidencia y alcance; nunca autoaprobarla.
- P2/P3, polish no bloqueante y post-MVP: registrar en el inventario secundario,
  no despachar ni añadir una feature paralela al ledger.
- Pérdida de datos, seguridad o exactitud de manufactura en una ruta incluida:
  no diferir silenciosamente; promover con evidencia y decisión explícita de alcance.
- #577 y exactitud de ProductionRelease → BOM/almacén/producción **no son secundarios**.

## Límites de promoción

No activar #497, #499, #503 ni extras por antigüedad, número o estado `pending`.
El rehearsal posterior al cierre real del P0 determina el siguiente requisito.
La lane de máquinas conserva dossiers e incógnitas `FIELD_VERIFICATION_REQUIRED`;
los nombres BHX 050/HPP 250 no justifican compatibilidad ni implementación sin
evidencia del cliente.
