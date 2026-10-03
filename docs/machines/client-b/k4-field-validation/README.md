# K4 — Validación de campo KDT Flexdrill 1200 (client-b, machine-c)

> **Estado**: `NOT_TESTED` hasta ejecutar esta sesión con readback completo
> y sign-off del operador. Nada de lo implementado en #1005 K1-K3 es un
> claim de compatibilidad: la matriz sólo se mueve con esta evidencia.
>
> **Patrón**: #348 (validación PTX con import/readback) ·
> `docs/verification.md` · dossier `docs/machines/client-b/machine-c-kdt-flexdrill1200.md`.

## Objetivo

Importar los programas KDTPanelFormat generados por Granete en la máquina
real del client-b, verificar el readback contra los valores esperados
(`expected-values.md`) y registrar limitaciones — en entorno seguro, sin
corte productivo, sin datos de cliente.

## Antes de la sesión (owner)

1. **Fixture**: exportar los programas del fixture desde la app real
   (proyecto con el contenido de `fixture-kdt-field-001` liberado → panel
   Optimización → "Descargar programas KDT (.zip)"). Verificar que los 3
   `.xml` del ZIP tengan los sha256 de `expected-values.md`
   (`shasum -a 256 *.xml`). Si no coinciden, cortar ahí y reportar.
2. **Software**: llevar anotado qué versión exacta del software de control
   muestra la máquina (pregunta abierta §15.5 del spec) y si el import
   valida versión en el XML.
3. **Entorno seguro**: sesión con el técnico/operador, máquina sin trabajo
   productivo en cola; los programas se cargan a la cola del control pero
   **no se ejecuta corte** sin aprobación explícita del taller.

## Protocolo de import y readback (por cada programa: 1, 2, 3)

| Paso | Qué hacer | Registro |
|---|---|---|
| I1 | Copiar el `.xml` a la máquina (USB/red, como el taller cargue Promob hoy) — anotar si el nombre `K<hash12>.xml` genera problema | método de carga + aceptación del nombre |
| I2 | Abrir/importar el programa en el control | ¿abre? ¿mensajes/advertencias exactos? |
| I3 | Verificar en la **vista previa** del programa: cantidad de operaciones (6/2/4), tipo (vertical/horizontal) por tabla | conteo por programa |
| I4 | Verificar **cada operación** contra `expected-values.md`: canto, coordenadas X1/Y1, Z1, diámetro, profundidad | matriz completa (checklist) |
| I5 | Verificar la **cara de alineación roja**: una sola, en el canto X=0 | sí/no + captura |
| I6 | Si el taller lo aprueba: simulación/dry-run del control (sin material o con descarte) | resultado |
| I7 | **NO ejecutar corte productivo** de este fixture | — |

## Clasificación y salida

- Cada diferencia = **blocker** (no coincide), **warning** (coincide con
  advertencia) o **unsupported capability** (el control espera algo que
  Granete no emite hoy: TypeNo 3/6/7, patrones HoleNo>1, Arc en Path).
- Resultado por versión de software: `VALIDATED` (todo coincide),
  `PARTIAL` (coincide con warnings/limitaciones registradas) o
  `UNSUPPORTED` (blockers). Sin sesión completa ⇒ sigue `NOT_TESTED`.
- El sign-off del operador cierra el acta. Con la evidencia sanitizada se
  actualiza el dossier (`machine-c`), la matriz de compatibilidad y — si
  corresponde — una nueva revisión del perfil (`r3`) con los datos de
  campo (ej. restricciones reales de nombre de archivo).

## Datos que la sesión debe capturar (para cerrar preguntas abiertas §15)

1. Versión exacta del software de control + ¿validación de versión?
2. Restricciones reales de nombre de archivo (longitud/caracteres) — hoy
   Granete usa `K<hash12>.xml` como candidato conservador.
3. ¿Cómo interpreta el control el AlignmentFace? ¿Coincide con la política
   Granete (canto X=0 contra el tope)?
4. ¿Existen TypeNo 4/5 distintos de lo documentado? ¿`<Arc>` en Path?
5. Comportamiento con `HoleNo > 1` (patrones IntervalX/Y) si el operador lo
   conoce.

## Reglas de sanitización de la evidencia

Sin nombres reales de clientes ni personal, sin credenciales, sin rutas
privados, sin datos comerciales. Capturas del control OK si muestran sólo
el programa del fixture (piezas sintéticas MOD-K4-P01/P02).
