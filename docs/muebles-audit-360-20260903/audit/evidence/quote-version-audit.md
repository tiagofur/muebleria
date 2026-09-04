# QV-01 — Historial automático omitido

**CONFIRMED source defect**, corroborado por síntoma guest observado por root. No es prueba backend.

changeProjectStatus llama transitionProjectStatus(project,status), que devuelve status nuevo; después pasa ese resultado a snapshotOnStatusChange(withTransition,status). El helper ve status idéntico y retorna sin snapshot ni incremento de version. VersionHistoryPanel lee project.history vacío y muestra que las versiones se crean automáticamente al cambiar estado.

## Causa

Orden incorrecto de composición: la condición project.status===newStatus del helper requiere el estado anterior, pero recibe el objeto posterior a la transición.

## Dos revisiones diferentes

El indicador recibe ProjectItem.structureRevisionPin: revisión de estructura del mueble congelada al cerrar. No usa Project.version ni Project.history; por sí solo no contradice historial vacío.

La prueba guest fue una cotización nueva creada por root; por ello no se explica solamente por datos seed antiguos. La causa estática coincide con ausencia de historial tras transición.

## Recomendación

Definir explícitamente si se snapshottea el estado anterior o el nuevo, preservar catálogo/pins/precio según ese contrato y componer transición/snapshot sin perder la diferencia oldStatus/newStatus. Añadir prueba del store para draft→quoted, quoted→accepted, reopen y reload de historial; después probar integración real API/PostgreSQL.

## Evidencia

- apps/web/src/stores/projectStore.ts:1024-1050
- packages/domain/src/engine/pricing.ts:392-438
- packages/domain/src/projectVersioning.ts:31-58
- packages/domain/src/projectVersioning.ts:96-104
- packages/ui/src/projects/components/VersionHistoryPanel.tsx:148-155
- packages/ui/src/projects/components/VersionHistoryPanel.tsx:193-203
- evidence/guest-quote-frozen-dom.txt:75
- evidence/guest-quote-frozen-dom.txt:90-93
- evidence/guest-quote-frozen-dom.txt:193

## Límites

- No se ejecutó en esta tarea un test store ni un workflow backend para este defecto.
- No se afirma que QuoteRevision/DesignRevision persistidos en backend sufran el mismo defecto.
- Restauración, produced y reapertura necesitan pruebas ejecutadas; aquí solamente se identifica el patrón estático.
