# ODD — #1138 OPEN-FRONT-10: Bottom overhang grip (caso C)

- **Estado**: IMPLEMENTED_PENDING_REVIEW (al cierre de este slice)
- **Base**: origin/main ef9be98d · **Rama**: `feat/1138-case-c-overhang`
- **Lane**: Delegated Direct (este artefacto)

## Alcance autorizado

Issue #1138 (status:approved): Caso C — `bottom_overhang` en muebles superiores
sin perfil de gola. Dependencias #1131 + OQ-3 en main.

## Decisión de diseño (la que la issue dejaba abierta)

**¿De dónde sale `overhangMm` "regla respaldada, no hardcode"?**

OQ-3 (§12 del doc) deja el VALOR del voladizo como pregunta abierta; la matriz
aprobada (§6 caso C) fija el COMPORTAMIENTO: puerta(s) hinged 1–2 extienden por
debajo del cuerpo un voladizo; cuerpo intacto; sin hardware de grip; tipo
`superior`. El hogar del valor respaldado es un **blob de overlay hermano**,
mismo mecanismo de #1134:

- clave `opening.bottom-overhang`, forma `{ "version": 1, "overhangMm": <int> }`
- parsers gemelos TS/Go fail-closed (versión ≠ 1, claves desconocidas, valor
  no entero-positivo ⇒ error de parseo, nunca interpretación)
- ausente ⇒ el sistema permanece **BLOCKED** (`OPENING_OVERHANG_EVIDENCE_PENDING`)
  — estado veraz de #1135 sin cambios; presente ⇒ el resolver aplica la regla
- pineable: el overlay compone en el resolve pineado (#1193), así que diseños
  históricos no cambian cuando la regla llega después (aceptancia 7)

Por qué no `opening.capabilities`: #1134 decidió explícitamente que ese blob no
lleva dimensiones ("cada milímetro es del OpeningProfile") y las claves
desconocidas fallan cerrado — meter `overhangMm` ahí rompería ambos invariantes.
Por qué no el OpeningProfile: el caso C no consume perfil (sin hardware). Un
blob de REGLA propio con esquema estricto es el tercer hogar legítimo de
milímetros declarados (perfil, body-modifiers del perfil, y ahora la regla de
fábrica versionada).

## Matemática (pineada por fixture)

- El resolve v1 divide la ALTURA DEL CUERPO (el cuerpo no cambia): caso C sin
  grips ⇒ zonas = reparto exacto de la altura del frente.
- La capa semántica (#1131) aplica el voladizo a los frentes que TOCAN el borde
  inferior (misma incidencia que los grips: vertical ⇒ última zona; horizontal
  ⇒ todas): `heightMm = zona + overhangMm` y campo declarado `overhangMm` en el
  front. Zonas que no tocan el borde quedan intactas.
- Sin regla ⇒ todo el comportamiento actual (goldens existentes intactos).

## Aceptancia → evidencia

1. overhangMm de regla respaldada ⇒ blob versionado + parsers gemelos + fixture.
2. Frente aumenta/reposiciona exactamente ⇒ fixture `resolutionCases` con caso C
   (expected fronts) consumido por TS y Go.
3. Cuerpo no cambia ⇒ availableFrontHeightMm/zonas idénticos con y sin regla
   (assert en tests); body modifiers intactos (sin grips no hay declaraciones).
4. Sin BOM de jaladera/gola ⇒ sin grips no hay consumo de perfil; test explícito.
5. Sólo familias compatibles ⇒ gate existente `byFurnitureType.grips
   .bottom_overhang` (validation) + test `placementRestricted`.
6. Golden ⇒ fixture compartido ampliado (caso C con regla; blocked sin regla ya
   estaba y NO se toca).
7. Pinneados estables ⇒ blobs ausentes en releases viejos ⇒ BLOCKED veraz;
   goldens previos byte-estables.

## Verificación

- `pnpm vitest run packages/domain/src/opening*` + typecheck workspace
- `go test ./internal/domain/... ./internal/api/...` (opening focused)
- Fixture compartido consumido por ambos runtimes.
