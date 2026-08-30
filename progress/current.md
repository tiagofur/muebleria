## Feature en curso

F198 — Parámetros tipados definition-driven para rich authoring resolve (#483 / SU-API-2)

Reabierta: 2026-08-30 15:00 America/Mexico_City

Plan de corrección del re-review de `8556de52`:

- Añadir binding booleano versionado `componentCondition` con efecto autoritativo y paridad Go/TS/Ruby.
- Remapear IDs internos de bindings al clonar catálogos y fallar transaccionalmente ante referencias no resolubles.
- Eliminar ambigüedad de targets por identidad estable de entrada o rechazo fail-closed.
- Habilitar edición accesible real de boolean y string en HtmlDialog, preservando `false` y `""`.
- Cerrar shapes desconocidos en Go/TS/Ruby y compartir negativos en el corpus.
- Versionar límites string y completar detalles estructurados seguros de issues.
- Regenerar fixtures, ejecutar PostgreSQL aislado, TestUp/RBZ final, CI y nueva revisión independiente.

### Boundary de implementación

1. `FurnitureDefinition` sigue siendo la autoridad; el binding, no el nombre del parámetro, decide la consecuencia.
2. `componentCondition` sólo consume boolean y apunta a una entrada de composición no ambigua.
3. `false` excluye la entrada y sólo sus relationships, machining y hardware dependientes; `true` conserva resultados deterministas.
4. Los clones remapean toda referencia binding al catálogo destino dentro de la misma transacción.
5. Shapes y límites son idénticos y fail-closed en Go, TypeScript y Ruby.
6. HtmlDialog edita los cuatro tipos sin crear una segunda pantalla ni mover autoridad al cliente.
7. Todo rechazo ocurre antes de `start_operation`; TestUp prueba cero geometría y metadata.
8. No se mergea PR #486 ni se cierra #483 en esta sesión.

### Integración de base

- `main` avanzó durante la corrección a `5f4eb311`; F197 quedó ocupado por #452.
- #483 fue reasignada programáticamente al siguiente ID libre, F198.
- La migration paramétrica se mueve a `000103`, después del head `000102` de Organization lifecycle.
