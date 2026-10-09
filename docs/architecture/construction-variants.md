# Construction Variants for the Body

- Status: **Propuesto — sólo fronteras y contrato inicial** (#1139). Ninguna
  parte de este documento autoriza implementación: runtime, UI, DB y resolver
  exigen una nueva aprobación de scope del owner.
- Decision record: [ADR-0010](../adr/0010-construction-variants.md)
- Epic: [#1128](https://github.com/tiagofur/muebleria/issues/1128) (track
  posterior del Opening/Front System)
- Related: [`opening-front-system.md`](opening-front-system.md) (ADR-0009),
  [`manufacturing-library-platform.md`](manufacturing-library-platform.md)
  (ADR-0008), [`factory-construction-and-joinery.md`](factory-construction-and-joinery.md)
  (#875/#1052), [`hardware-profiles.md`](hardware-profiles.md)

## 1. Propósito

La regla de oro del Opening/Front System («una opción que cambia geometría,
materiales, herraje o manufactura es una regla resoluble del servidor, nunca
metadata») aplica igual al **cuerpo**: elegir entre tapa completa, tapa con
celosía (mullion), espalda ranurada o un zócalo construido cambia componentes,
maquinado y BOM. Hoy esas elecciones no existen como dimensión modelada: cada
combinación de cuerpo × apertura termina siendo una nueva `Structure`
(explosión combinatoria) o fórmulas editadas a mano.

`ConstructionVariant` es la dimensión que hace el CUERPO opcionable, de la
misma manera que el Opening System hizo opcionables los frentes. Este
documento fija **fronteras y contrato inicial** para que esa futura
implementación reutilice los mecanismos existentes en lugar de crear
mecanismos paralelos.

## 2. Fronteras duras (lo que ConstructionVariant NO es)

| Frontera | Razón |
| --- | --- |
| **No mezcla con Opening.** `ConstructionVariant` es independiente de `OpeningLayout`, `GripSystem`, `OpeningProfile` y `Front Positioning` (#1139). Un variant convive con cualquier sistema de apertura; ningún lado lee el intent del otro. | Son dimensiones ortogonales por diseño (ADR-0009 §3). Mezclarlas recrea la explosión combinatoria que ambas capas existen para evitar. |
| **No es un mecanismo nuevo.** Reutiliza el overlay y release de la biblioteca (ADR-0008), el patrón de capabilities fail-closed (#1134), el direccionamiento por `ConstructiveRole` (#1052) y el patrón de body modifiers declarados por perfil (#1132). | El sistema ya demostró Biblioteca → Fábrica → Mueble en el track Opening; un segundo catálogo, motor, ledger o coordinador viola las invariantes del repo. |
| **No es política de fábrica.** `joint.*` (construcción policy) es la política de UNIÓN de la fábrica (#875); el variant es INTENCIÓN semántica del mueble, resuelta por el servidor. Pueden componer, pero no son lo mismo. | Confundirlos pondría la elección de diseño del mueble en el canal de política industrial, o viceversa. |
| **No hay runtime/UI/DB en esta etapa.** La aceptación de #1139 es explícita: esta etapa sólo documenta fronteras y contrato inicial. | «Nueva implementación requiere nueva aprobación de scope.» |

## 3. Contrato inicial (borrador de fronteras, no especificación de implementación)

```text
Furniture definition (Module + Structure)
└── Body
    ├── Construction Variant   (qué componentes del cuerpo existen y cómo se
    │                           encuentran — intención semántica declarada)
    └── [Opening System]        (ADR-0009 — capas independientes, ya modeladas)
                 │
                 ▼
        Server resolve: componentes por ConstructiveRole + machining + BOM
```

1. **Intención semántica declarada.** Un `ConstructionVariant` se selecciona
   como identidad exacta (variante + parámetros tipados) — nunca derivado de
   nombres, fórmulas editadas a mano ni flags sin validar. Misma postura que
   el Opening: el resolve es del servidor; React no recrea resolve/pricing.
2. **Server resolve con salida por ConstructiveRole.** El resolver produce
   componentes del cuerpo direccionados por el vocabulario de roles
   (#1052: horizontal | lateral | shelf | back | door | divider | custom) y
   maquinado por rol — el patrón que #1132 ya demostró con body modifiers
   por rol. Ninguna salida por nombre de componente.
3. **Capabilities y releases reutilizan los mecanismos existentes.** La
   fábrica declara qué variantes ofrece mediante el overlay de la biblioteca
   (mismo mecanismo que `opening.capabilities` y `joint.*`: namespace propio,
   parsers gemelos TS/Go fail-closed, claves desconocidas = error); los
   diseños pinneados resuelven contra el release exacto (ADR-0008/#1193) —
   una variante que llega después jamás reescribe diseños históricos.
4. **Paridad TS/Go por fixture compartido** para cualquier regla que viva en
   ambos runtimes — igual que los resolvers de opening (#1129–#1133).

## 4. Preguntas abiertas (para el futuro scope aprobado)

- Variantes piloto y su vocabulario (¿tapa completa vs mullion? ¿espalda
  ranurada? ¿zócalo construido?) y cómo interactúan con la construcción de
  componentes ya persistida (#1052 slice 1: caras/rol/sistema).
- Forma exacta del intent persistido y su portador en el diseño (el patrón
  `AuthoringDefaults` del carrier de apertura es el precedente).
- Contract fixtures y goldens compartidos, y su versión.
- Migración de muebles existentes (los cuerpos actuales equivalen al variant
  por defecto; el default no puede reescribir historia pinneada).

## 5. Gate

> **Nueva implementación requiere nueva aprobación de scope del owner.**
> Este documento no activa writers de producto, ni migraciones, ni UI; su
> único entregable son las fronteras y el contrato inicial aprobados en
> [#1139](https://github.com/tiagofur/muebleria/issues/1139).
