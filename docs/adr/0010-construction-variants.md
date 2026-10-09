# ADR-0010 — Construction Variants for the Body: fronteras y contrato inicial

- Status: **Proposed**
- Date: 2026-10-10
- Decision owners: Granete architecture
- Canonical detail: [`docs/architecture/construction-variants.md`](../architecture/construction-variants.md)
- Issue: [#1139](https://github.com/tiagofur/muebleria/issues/1139) (épica [#1128](https://github.com/tiagofur/muebleria/issues/1128))

## Context

El Opening/Front System (ADR-0009) separó cómo se abre un mueble de cómo se
construye su cuerpo, y su track (#1129–#1137) demostró el patrón completo:
contrato semántico, perfil/resolver separados, release pinning, capabilities
fail-closed, machining por `ConstructiveRole`, BOM y paridad TS/Go.

La otra mitad de la separación — que el CUERPO también sea opcionable (tapa
completa vs mullion, espalda ranurada, zócalo construido) — no existe como
dimensión modelada: cada combinación de cuerpo × apertura termina en una
`Structure` nueva (explosión combinatoria) o en fórmulas mantenidas a mano.
El track Opening es posterior a esta idea (#1139: «track posterior; no
implementar en el primer ciclo») y su condición ya se cumplió.

## Decision

1. **`ConstructionVariant` es una capa independiente del cuerpo**, ortogonal a
   `OpeningLayout`, `GripSystem`, `OpeningProfile` y `Front Positioning`.
   Ninguna capa lee el intent de la otra.
2. **Será intención semántica declarada + server resolve** (variante con
   identidad exacta y parámetros tipados; React nunca recrea resolve), con
   salida por `ConstructiveRole` y machining por rol (#1052, patrón #1132).
3. **Reutiliza los mecanismos existentes**: overlay y release de la biblioteca
   (ADR-0008), patrón de capabilities fail-closed (#1134), release pinning
   (#1193) y paridad TS/Go por fixture compartido. No se crean catálogos,
   motores ni ledgers paralelos.
4. **Esta decisión SOLO documenta fronteras y contrato inicial.** Toda
   implementación (runtime, UI, DB, resolver) requiere una nueva aprobación
   de scope del owner; este ADR no la autoriza.

## Consequences

- El eje de cuerpo queda preparado para ser opcionable sin tocar el Opening
  System y sin combinatoria de structures.
- El gate de implementación evita arrancar runtime antes de que el owner
  apruebe variantes piloto, vocabulario, portador del intent y goldens.
- Los mecanismos reutilizados ya están demostrados en producción por el track
  Opening, lo que acota el riesgo de la futura implementación a las
  preguntas abiertas listadas en el documento canónico.
