# Valores esperados — fixture de campo K4 (KDT Flexdrill 1200)

> **Fuente**: fixture congelado `fixture-kdt-field-001`
> (`packages/excel/src/machines/kdt/fieldFixture.ts`), generado por la
> tubería real Granete → KDTPanelFormat (adapter `granete-kdt@0.2.0`,
> perfil `kdt-flexdrill-1200@r2`). Los hashes están verificados por test
> contra el código: si este doc y el código llegan a divergir, CI falla.
>
> **Estado de la validación**: `NOT_TESTED` hasta la sesión de campo con
> readback y sign-off del operador (#1005 K4).

## Programas del fixture (3 archivos)

| Clave | Pieza | Cara arriba | sha256 |
|---|---|---|---|
| `MOD-K4-P01:front` | MOD-K4-P01 · Lateral K4 P01 (600×400×18) | **front** (Face A) | `89d30b7825890d419c35311a7cbcb51ea58bce8526d97f620532f4d8bbf8c70f` |
| `MOD-K4-P01:back` | MOD-K4-P01 · Lateral K4 P01 (600×400×18) | **back** (Face B) | `6c1d884b9e9bdbe84de82e74ba75c570db13eedf061c8a5003785fd647702125` |
| `MOD-K4-P02:front` | MOD-K4-P02 · Base K4 P02 (600×400×18) | **front** (Face A) | `41987e71c9a5cc01c878e270ebc99ed0ef583151cf8d04f5fcd6c0c755ad170c` |

Nombres de archivo industriales: `K<hash12>.xml` (ver el ZIP descargado; el
mapeo archivo→piezas está en cada `manifest.json`). En ambos archivos el
canto de **alineación (AlignmentFace, rojo)** es el canto X=0
(Quadrant 2 = canto inferior de la pieza en orientación de taller).

## Programa 1 — MOD-K4-P01, cara **front** arriba (6 operaciones)

Coordenadas KDT: origen (0,0) = esquina inferior izquierda de la cara
superior; X a lo largo de 600 (largo), Y a lo largo de 400 (ancho).

| # | Operación | TypeNo | Canto (Quadrant) | X1 | Y1 | Z1 | Ø | Prof. |
|---|---|---|---|---|---|---|---|---|
| 1 | pin entrepaño 1 | 1 | — | 100 | 350 | — | 5 | 10 |
| 2 | pin entrepaño 2 | 1 | — | 100 | 50 | — | 5 | 10 |
| 3 | minifix canto superior | 2 | 1 (X=600) | 600 | 200 | 9 | 15 | 12 |
| 4 | tarugo canto inferior | 2 | 2 (X=0) | 0 | 200 | 9 | 8 | 15 |
| 5 | tornillo excéntrica canto izq. | 2 | 3 (Y=400) | 300 | 400 | 9 | 5 | 36 |
| 6 | tornillo bisagra canto der. | 2 | 4 (Y=0) | 200 | 0 | 9 | 4 | 12 |

## Programa 2 — MOD-K4-P01, cara **back** arriba (2 operaciones)

| # | Operación | TypeNo | X1 | Y1 | Ø | Prof. |
|---|---|---|---|---|---|---|
| 1 | tarugo 1 | 1 | 500 | 50 | 8 | 12 |
| 2 | tarugo 2 | 1 | 500 | 350 | 8 | 12 |

> Misma pieza física que el Programa 1 — el archivo B mecaniza la otra
> cara: el operador carga el panel con la cara trasera hacia arriba.

## Programa 3 — MOD-K4-P02, cara **front** arriba (4 operaciones, sólo cantos)

| # | Operación | TypeNo | Canto (Quadrant) | X1 | Y1 | Z1 | Ø | Prof. |
|---|---|---|---|---|---|---|---|---|
| 1 | tornillo excéntrica izq. 1 | 2 | 3 (Y=400) | 150 | 400 | 9 | 5 | 36 |
| 2 | tornillo excéntrica izq. 2 | 2 | 3 (Y=400) | 450 | 400 | 9 | 5 | 36 |
| 3 | tornillo excéntrica der. 1 | 2 | 4 (Y=0) | 150 | 0 | 9 | 5 | 36 |
| 4 | tornillo excéntrica der. 2 | 2 | 4 (Y=0) | 450 | 0 | 9 | 5 | 36 |

> Mismas dimensiones que P01: largo 600 (X), ancho 400 (Y), espesor 18.

## Reglas de verificación en la máquina (readback)

1. **Cantidad por programa**: 6 / 2 / 4 operaciones — nunca más, nunca menos.
2. **Tipo**: TypeNo 1 = taladro vertical desde la cara cargada hacia abajo;
   TypeNo 2 = taladro horizontal desde el canto indicado por Quadrant
   (1=X=600, 2=X=0, 3=Y=400, 4=Y=0 para las piezas 600×400).
3. **Profundidad y diámetro** exactos por tabla (mm).
4. **Z1 = 9.0** en todos los horizontales (centro del espesor 18).
5. **Alineación**: exactamente una cara roja (AlignmentFace) por archivo,
   sobre el canto X=0; el operador carga ese canto contra el tope.
6. **No asumir Z1 centrado como regla general**: el corpus real contiene
   contraejemplos (BA42011A: Z1=7.5 con T=15.5). Este fixture usa Z1
   centrado por diseño; el programa muestra el valor que Granete programó.

## Clasificación de hallazgos

- **blocker**: el programa no abre, una operación falta/sobra, o cualquier
  coordenada/diámetro/profundidad difiere de la tabla.
- **warning**: abre y coincide pero con advertencias del control (nombres
  de archivo largos, mensajes de versión, etc.).
- **unsupported capability**: algo que Granete no emite hoy (TypeNo 3/6/7,
  patrones HoleNo>1) que el control pida de otra forma.

Todo hallazgo se registra en el acta de sesión (checklist del operador) y
alimenta el dossier/perfil — nunca se ajusta el fixture para "hacer pasar"
la máquina.
