# Benchmark de usabilidad Proyectar 5★ — protocolo y kit (#314 / P3D-8)

> **Qué es esto.** El protocolo canónico para medir si Proyectar alcanza la
> calidad definida en `docs/proyectar-3d-north-star.md` **con usuarios reales**,
> y el kit de medición que la convierte en evidencia estructurada. #314 es
> validación de producto, no una feature; **no se cierra sin sesiones reales
> registradas según este protocolo**.
>
> Data truth: toda sesión lleva `source: "real" | "proxy"`. Los tiempos
> `proxy` (automatización, p.ej. `pnpm smoke:usability`) **no son evidencia de
> usuario**; sirven como referencia técnica y regresión del script.

---

## 1. Script canónico (11 tareas)

El participante debe completar **sin coaching significativo**. El orden es
fijo; las tareas están versionadas (`USABILITY_TASKS_VERSION`) en
`packages/ui/src/preview3d/usabilityBenchmark.ts`.

| # | Tarea (id) | Qué se le pide |
|---|---|---|
| 1 | `open-project` | «Abrí el proyecto de la cocina y entrá al diseño 3D» |
| 2 | `find-module` | «Encontrá en la biblioteca un mueble bajo de 600 mm» |
| 3 | `place-module` | «Colocá el mueble en el muro de la cocina» |
| 4 | `duplicate-align` | «Duplicá el mueble y alineá la corrida en el muro» |
| 5 | `edit-dimension` | «Cambiá una dimensión del mueble a tu criterio» |
| 6 | `add-aggregate` | «Sumá una cajonera al ambiente» |
| 7 | `apply-front-material` | «Cambiá el material de los frentes del mueble» |
| 8 | `apply-floor-material` | «Cambiá el material del piso del ambiente» |
| 9 | `switch-space` | «Andá a otro ambiente y volvé a la cocina» |
| 10 | `present` | «Presentale el diseño al cliente» |
| 11 | `verify-price-bom` | «Verificá el precio total y las piezas de un mueble» |

> **Nota sobre "Roble" (#314 literal).** El script original dice "aplicar Roble
> a frentes". La intención de la tarea es el **scope** (frentes), no un material
> literal del catálogo: la consigna operativa es "aplicar a los frentes un
> material distinto del actual". En el seed demo el tablero de frentes
> disponible es MADERADO FRENTE.

## 2. Métricas y cómo se capturan

| Métrica (#314) | Captura |
|---|---|
| Tiempo por tarea | auto — facilitador marca start/complete; la app timesta­mpa |
| Errores | facilitador — botón «+ Error» (contabiliza y lo anota en la hoja) |
| Retrocesos | auto — eventos `undo`/`redo` atribuidos a la tarea vigente |
| Ayuda solicitada | facilitador — botón «+ Ayuda» |
| Clicks/acciones innecesarias | auto — clicks del documento (excluye el panel del facilitador) + eventos de acción (`insert`, `command`, `library_search`, …) |
| Dónde busca los controles | observación del facilitador (hoja) + pregunta post-sesión |
| Confianza percibida | encuesta post-sesión (§6) |
| Facilidad percibida | encuesta post-sesión (§6) |

Taxonomía de eventos auto: `library_search`, `insert` (click/drag),
`move_commit` (drag muro/isla), `command` (duplicar/alinear/distribuir/centrar/
nudge/pegar, con `intent`), `dimension_edit`, `option_change` (agregados),
`material_boards_apply` (scope frentes/interior/todo/obra),
`material_ambient_apply` (piso/muro/techo/mesada), `space_switch`, `space_add`,
`undo`, `redo`, `present_open/close`, `bom_detail`, `click`.

## 3. Targets iniciales (recalibrables con evidencia)

Definidos en `USABILITY_TARGETS` (mismo módulo). **Regla de #314: los targets
se recalibran con evidencia**; un target que ningún participante alcanza pero
que todos consideran fácil es un target mal calibrado, no un producto roto — y
viceversa.

| Target | Definición | Meta inicial |
|---|---|---|
| Primer módulo colocado | encontrar + colocar (t2+t3) | < 60 s |
| Material común aplicado | aplicar a frentes (t7) | < 15 s |
| Agregado común añadido | añadir cajonera (t6) | < 30 s |
| Duplicar/alinear 3 unidades | t4 | < 30 s |
| Cero internals del BOM | cualitativo (t11) | el participante verifica precio/piezas sin que el facilitador explique conceptos internos del BOM |

## 4. Preparación de la sesión

1. **Consentimiento** verbal o escrito: se graba pantalla (opcional) y se
   registran tiempos/acciones; el participante se reporta como anónimo
   (P1, P2…). Nunca datos de clientes reales en el proyecto de la sesión.
2. Workspace fresco en modo invitado (guest) sobre el seed **Demo plantilla**;
   sin proyectos reales del taller.
3. Activar el kit: en la consola del navegador,
   `localStorage.setItem('muebles_usability_benchmark','1')` y recargar. Aparece
   el panel del facilitador (esquina inferior izquierda, colapsable).
4. Verificar `pnpm smoke:usability` verde en el build que se va a probar (el
   script debe ser completable en esa versión).
5. pantalla completa, mouse propio del participante, ~30 minutos bloqueados.

## 5. Rol del facilitador (regla: sin coaching)

- **Arranca la sesión desde el panel ANTES de entregar el mouse**, anota el
  participante (P1, P2…), fuente `real`.
- Lee la consigna de la tarea **textual** (el panel la muestra). No demuestre,
  no señale la pantalla, no anticipe el resultado.
- Frases permitidas: repetir la consigna; «contame qué estás buscando» (sin
  responder dónde está); «¿qué esperaba que pasara?».
- Marca **Iniciar** al terminar de leer la consigna y **Completada** cuando el
  resultado observable existe (mueble colocado, frentes cambiados, presentación
  abierta…). **Abandonada** si el participante se rinde o pide que lo hagan.
- **+ Ayuda** cada vez que responde una pregunta del participante.
- **+ Error** por acción con resultado no deseado por el participante (borró,
  aplicó donde no quería, etc.).
- No corrige el estado del proyecto entre tareas: los errores del participante
  son parte de la medición (sólo restaurar si el proyecto queda inutilizable).

## 6. Post-sesión (encuesta y registro)

Inmediatamente después, mismo participante:

1. Confianza percibida: «¿qué tan seguro te sentiste haciendo esto?» (1–5).
2. Facilidad percibida: «¿qué tan fácil te resultó?» (1–5).
3. «¿Dónde buscaste primero [los muebles / los materiales / cómo presentar]?»
   (abierta — alimenta "dónde busca los controles").
4. «¿Qué cosa hizo más difícil de lo que esperabas?» (abierta).
5. Comentario libre.

Cierre técnico: **Terminar sesión** → **Exportar** (JSON) y guardar como
`progress/benchmark/sessions/<fecha>-<Pn>.json`; volcar la encuesta y notas en
el mismo archivo (campos `survey`/`notes`) o en un `.md` hermano. La sesión
persiste en localStorage y sobrevive recargas; **Nueva sesión** limpia para el
siguiente participante.

## 7. Análisis y reporte

- `summarizeUsabilitySessions(sessions)` (`@granete/ui`, testeado) agrega:
  tiempos por tarea (mediana), abandonos, ayudas, errores, retrocesos
  (undo/redo), clicks, y cumplimiento de targets (`metRatio`).
- Reporte mínimo por tanda de sesiones: tabla por tarea (mediana + rango +
  ayudas + errores + retrocesos) vs targets, más hallazgos cualitativos.
- **Regla de #314:** los hallazgos pueden reordenar #309–#313 y #277–#297 —
  un target sistemáticamente incumplido con evidencia de causa genera/reordena
  issues con esa evidencia adjunta.

## 8. Baseline proxy (referencia técnica, NO evidencia de usuario)

`pnpm smoke:usability` corre el script completo como facilitador automático
(`source: "proxy"`, participant `proxy-agent`) y exporta
`test-results/proyectar-usability-proxy.json`. Última corrida documentada
(2026-08-23, dev build, Chromium headless):

| Tarea | s (proxy) |
|---|---:|
| open-project | 1.4 |
| find-module | 0.4 |
| place-module | 10.5 |
| duplicate-align | 7.9 |
| edit-dimension | 2.4 |
| add-aggregate | 5.0 |
| apply-front-material | 6.0 |
| apply-floor-material | 6.5 |
| switch-space | 2.1 |
| present | 0.9 |
| verify-price-bom | 7.1 |

74 eventos, 34 clicks, todos los tipos capturados. Estos números sólo prueban
que **el script es completable y el kit captura**; un participante real tardará
órdenes más y cometerá errores — esa es la señal que importa.

## 9. Regresión permanente

El smoke (`pnpm smoke:usability`, incluido en `pnpm smoke`) afirma:

- las 11 tareas completables con la UI real en el build actual;
- cada tarea con duración > 0 y sus eventos requeridos capturados;
- el JSON exportado parsea con `source: "proxy"`.

Si una feature rompe un paso del script, el smoke falla **antes** de que llegue
a un participante real.

## 10. Hallazgos conocidos del kit (registro)

- **#338** — guest + proyecto seleccionado + reload produce render loop en
  Cotizaciones (~55 remontajes/s). Preexistente, detectado al intentar validar
  la recarga in-browser; la persistencia de sesión queda cubierta a nivel
  unitario (`simulateUsabilityReloadForTests`) hasta resolverlo.
- Materiales ambientales sólo aplican por drag (el piso no tiene select) —
  sesiones tempranas pueden registrar fricción aquí; es dato, no bug del kit.
