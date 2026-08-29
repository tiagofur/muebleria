# F193 review status

## Estado

`disabled/unmanaged`

Receipt-driven review mode está deshabilitado por la política efectiva del
repositorio. No se ejecutó un reviewer, este archivo no contiene un veredicto y
F193 permanece `in_progress`.

## Condición para cierre

Una revisión independiente sólo se iniciará si el maintainer habilita
explícitamente `gentle-ai review mode`. Hasta entonces, los tests locales y CI
son evidencia técnica, pero no sustituyen un `APPROVED` independiente ni
autorizan cambiar F193 a `done`.
