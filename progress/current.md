## Feature en curso

F197 — Parámetros tipados definition-driven para rich authoring resolve (#483 / SU-API-2)

Reabierta: 2026-08-30 13:19 America/Mexico_City

Plan de corrección del review de `97194c9a`:

- Vincular parámetros tipados a composición autoritativa y rechazar definiciones sin consumidor.
- Unificar los entry points TypeScript con el evaluator estricto y eliminar coerciones paralelas.
- Reservar/proteger W/H/D, validar publicación y enriquecer issues estructurados fail-closed.
- Añadir down migration, tenant isolation, corpus inválido y TestUp real-host con evidencia parseable.
- Ejecutar gates completos, obtener revisión independiente, actualizar el mismo PR #486 y confirmar CI/readback.

### Boundary de implementación

1. Entidad semántica: `FurnitureDefinition`/módulo y sus slots de composición.
2. Identidad estable: `furnitureDefinitionId`; las ocurrencias resueltas conservan `componentInstanceId`.
3. La intención son parámetros tipados; la salida autoritativa es `NativeLayout` + relationships + machining + fingerprint.
4. La autoridad de validación y consecuencias es el dominio/engine Go, nunca Ruby ni el handler HTTP.
5. Se reutilizan los bindings `quantityParameter`/`conditionParameter` existentes en el dominio TS y el resolver/layout Go.
6. Definición o valor inválido falla antes de construir layout y antes de cualquier mutación del host.
7. Una aceptación se aplica como una única operación undoable de SketchUp.
8. Positivos: defaults y `shelfCount=1` vs `3` cambian composición, relaciones, machining y fingerprint.
9. Negativos: parámetro sin consumidor, tipo/rango/step/enum, dimensión reservada incompatible y catálogo corrupto.
10. Evidencia real-host obligatoria: TestUp contra RBZ instalado, con SHA-256 y JSON parseable.
11. No depende de Gate A/#384: extiende el catálogo de módulos existente y no crea una familia persistente nueva.
