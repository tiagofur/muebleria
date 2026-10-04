# HOMAG/WEEKE BHX 050 — integración nativa además del DXF

> Requisito confirmado por el propietario: 2026-09-27. Implementación: [#879](https://github.com/tiagofur/muebleria/issues/879). Coordinación: #351/#503/#776; evidencia de instalación: #352; uniones: #874. Estado: **especificación objetivo, NOT_TESTED/notClaimed**. No se generó ni ejecutó un programa de máquina con esta entrega documental.

## B1. Autoridades y objetivo

La BHX 050 es un destino CNC obligatorio y separado del DXF. Se reutiliza el [dossier de client-a/machine-a](../client-a/machine-a-bhx050.md) y su [checklist](../client-a/intake-checklist.md); no se crea otro registro de la instalación. El dossier confirma modelo/familia, no versión de software, formato exacto, tooling ni límites. HPP 250 es machine-b del mismo cliente: ni su perfil ni su evidencia sirven como homologación BHX; Client B sigue separado.

Reutilizar [perfiles/adapters](../../architecture/machine-profiles-and-adapters.md), [construcción/uniones](../../architecture/factory-construction-and-joinery.md) y [proyección DXF](../../manufacturing/dxf-cut-plan-projection.md). #351/PR #588 aporta contratos; #591/PR #592, selección persistida que excluyó sintaxis MPR; #503, artefactos/Ingeniería; #739, snapshot congelado; #789, etiquetas/cncDrawingRef. No reabrir bases cerradas ni crear otro registry, motor de uniones o store de selección. Inspeccionar las implementaciones vigentes antes de extenderlas.

Objetivo: piezas y operaciones neutrales completas → plan de montajes de la instalación → adapter nativo versionado → programas/manifest → receptor OEM → validación independiente. **woodWOP/MPR es la familia inicial a contrastar**, no una aceptación ya comprobada. La integración no exige convertir DXF a MPR, no reconstruye operaciones desde CIRCLE y no es un generador NC/G-code genérico. La compilación final de macros al control queda en el software OEM confirmado.

### B1.1 Kit de recolección (2026-10-03)

El [`b1-woodwop-evidence-kit.md`](./b1-woodwop-evidence-kit.md) concreta la
recolección de muestras: preparar con el woodWOP del cliente los programas
del fixture congelado `fixture-kdt-field-001` (mismas 12 operaciones que el
kit K4 de KDT — un fixture, dos receptores), sanitizar, y capturar
versión/herramientas/caras/pinzas. Con la Muestra A/B aceptada arranca B2
con evidencia primaria; sin muestras, B2 sigue bloqueado
(`NATIVE_FORMAT_RECEIVER_NOT_CONFIRMED`).

### B1.2 Mapa de consumidores (actualizado 2026-10-03, post-#1005 K1-K3)

El camino KDT generalizó el pipeline de mecanizado. Estado del seam para
BHX:

- **Seleccionable y persistido**: el catálogo ya tiene la máquina
  `client-a-machine-a-bhx050`, el perfil `mpr-woodwop@r1` y el adapter
  `woodwop-mpr@0.1.0` (`serializerImplemented: false`); la tupla valida y
  persiste, la generación bloquea con `SERIALIZER_NOT_IMPLEMENTED`
  (la tarjeta de settings lee «Bloqueado» — correcto hasta tener evidencia).
- **Flujo de generación existente y fail-closed**:
  `generateSelectedMachiningOutput` resuelve la tupla exacta y produce
  bundles por pieza (manifest `by-piece`, provenance congelado, nombres
  industriales deterministas). Hoy la frontera de capacidad sólo deja pasar
  a la familia per-piece implementada (kdt) — abrir woodWOP es extender esa
  frontera cuando el serializer exista, nunca un fallback.
- **Entrada lista**: `ProjectDrillingData` con las seis caras bajo el marco
  canónico (proyecciones axis-aligned de `hardwarePlacement`) +
  `thicknessMm` cableado end-to-end desde el despiece y desde el snapshot
  congelado de la liberación (mismo camino frozen-only que KDT: sin
  autoridad canónica, cero archivos — nunca heurísticas F074 a una máquina).
- **Fixture compartido**: `fixture-kdt-field-001` (3 programas, 12
  operaciones, expectativas valor-por-valor y hashes pinned bajo test) es
  el vector expected que el futuro serializer MPR debe reproducir en su
  gramática — mismo fixture, dos receptores.
- **Delta restante para B2** (nada de esto existe hoy): dimensiones del
  perfil evidenciadas desde muestras reales (kit B1.1), serializer +
  lector independiente (BHX02), el subconjunto que la evidencia habilite
  (BHX03-BHX06) y el readback de instalación bajo #352 (BHX12).

## B2. Evidencia que falta y fuentes primarias

Capturar en el dossier existente: variante/año y placa sanitizada; controlador y build; software y versión/build; programas nativos pequeños que ya funcionen y su resultado esperado; versión/gramática/encoding/unidades; herramientas equipadas y sus IDs/mapa; origen, cara de referencia, orientación de alimentación, pinzas y zonas prohibidas; tamaños/espesores; reglas de cara opuesta/reorientación; flujo de transferencia/selección y barcode si está equipado. No solicitar otra vez el modelo ya confirmado ni inventar el resto. Preferir programas sintéticos preparados con el receptor y sanitizar nombres/rutas/referencias. Conservar hash del original en ubicación autorizada y hash de la copia saneada; nunca ejecutar macros o evaluar expresiones arbitrarias para inspeccionar muestras.

Fuentes consultadas el 2026-09-27, **PUBLIC_REFERENCE_ONLY**: [HOMAG woodWOP](https://www.homag.com/en/product-detail/software/work-preparation/cnc-programming-software-woodwop) describe programación de operaciones y simulación opcional; [HOMAG: ejemplo BHX 050](https://www.homag.com/es/empresa/actual/referencias/detalle/comodidad-y-precision-gracias-a-la-digitalizacion) describe taladrar/ranurar/fresar y selección por etiquetas en otro taller; [descargas CNC oficiales](https://www.homag.com/en/service/software-downloads/cnc-software-downloads) enlazan ejemplos y documentación de software. No prueban la configuración de este cliente ni constituyen por sí solas una especificación de sintaxis.

[HOMAG sobre la evolución BHX 050/055](https://www.homag.com/en/company/news/news/article/its-grown-up-but-stayed-small-the-new-drillteq-v-110-continues-a-success-story) distingue las generaciones y sus cambios; NO copiar límites/control de DRILLTEQ V-110/V-200 a la BHX existente. [Formato MPRXE de HOMAG](https://docs.homag.cloud/docs/en/neues-speicherformat-mprxe) documenta otra opción actual; su existencia NO obliga a sustituir MPR ni demuestra que el receptor antiguo la admita. MPR/MPRX/MPRXE se seleccionan por contrato exacto, no por fecha o extensión parecida.

Por cada macro/campo del subconjunto: fuente primaria y localizador, versión, semántica, unidad, opcionalidad, orientación, encoding y expected independiente. Datos desconocidos se mantienen pendientes y bloquean el caso que los necesita; no retrasan toda la investigación ni autorizan adivinarlos. La frase histórica «adapter permanece bloqueado» del dossier se refiere a su estado de descubrimiento: #879 separa candidato offline documentado de validación de la instalación. Implementación requiere aprobación/reserva normal; no se autoactiva por publicar este documento.

## B3. Entrada neutral y planificación por pieza

#874 determina qué maquinados exige cada unión y #775/#875 qué política válida elige la fábrica. La BHX recibe el resultado; no cambia cantidad de tornillos, coloca un minifix por intuición ni deriva operaciones de nombres/materiales. Una receta puede exigir varias operaciones en caras distintas para un solo herraje. El input conserva ocurrencia/definición/revisión, cara y punto de entrada, eje/dirección, diámetro, profundidad y condición ciega/pasante, contorno/ranura cuando aplique, requisitos, provenance e integridad de la resolución.

Auditar el seam actual: si sólo contiene proyección 2D o un ResolvedCuttingJob, no simular un job de mecanizado dentro de él. Evolucionar el contrato neutral mínimo con su owner y pruebas/paridad generada pertinentes. No duplicar el dominio de máquina. Resultados parciales, referencias huérfanas y errores de BOM/perfiles no se vuelven completos al eliminar diagnósticos; reutilizar el principio de integridad #676, no su salida planar como fuente CNC.

La unidad de trabajo es la pieza y su montaje, no el tablero completo de nesting. El caso habitual de continuidad es corte HPP 250 → identificación de piezas → etapas de canto/mecanizado según routing confirmado → BHX 050. No fijar universalmente el orden entre canto y perforación: geometría de entrada y offsets deben corresponder a la etapa real. No descontar cantos dos veces ni escalar para hacer coincidir pieza terminada/cruda. La ubicación y `rotated` del optimizador no determinan cómo carga el operador la pieza ya separada.

## B4. Caras, herramientas y montajes

Definir una transformación explícita pieza→montaje→marco nativo. Transformar puntos, direcciones y superficies, no sólo intercambiar dimensiones. Probar inversa y las seis caras; ello exige representar/bloquear cada caso, NO supone capacidad de taladrar las seis caras en una carga. Separar cara intrínseca, normal, entrada de broca y cara presentada a máquina. La disposición vertical de la BHX no convierte todos los agujeros en «verticales» ni fija el signo de Z.

Nunca heredar el espejo posterior de presentación de #676. Ese espejo define un dibujo, no la cinemática ni el setup BHX. Una pieza girada globalmente en SketchUp conserva sus operaciones locales; una reorientación física de carga usa una transformación de montaje confirmada. Una cara inaccesible requiere otro montaje explícito, identificado e instruido con evidencia, o bloqueo: no omitirla, espejar dos veces ni cambiarla a frontal.

El perfil de instalación valida tamaños/espesores, cara y dirección accesibles, diámetro/profundidad, herramienta disponible, pinzas y zonas de seguridad documentadas. No inventar tooling, rpm, avances, mordazas/regrips o posiciones seguras. Si el receptor selecciona herramienta por requisitos en vez de ID, ese modo también debe documentarse y probarse. No intentar sustituir collisionControl u otras seguridades OEM; las verificaciones Granete no eliminan las del fabricante.

Cobertura obligatoria: cada operación requerida está asignada a pasos/programas/montajes admitidos o produce blocker antes de emitir un lote fabricable. Una operación puede expandirse en varios pasos con correspondencia explícita, sin omisión ni ejecución doble. Reorientación no soportada, herramienta ausente, perfil desconocido o fallo de resolución bloquean; no cambian silenciosamente receta, cantidad, geometría ni salida. No-op legítimo y ausencia de información son estados diferentes.

## B5. Adapter, archivos, identidad y UI

Subconjunto inicial: perforaciones de cara y canto, ciegas/pasantes y alojamientos bajo el contrato confirmado; ranuras cuando el equipo/perfil lo soporte; fresado sólo con equipamiento y gramática verificados. Comenzar con un programa pequeño y ampliar por operaciones demostradas. No usar un único diámetro/profundidad de excéntrica como receta minifix completa. El lector independiente consume bytes emitidos y compara operaciones, no sólo apertura de archivo; no compartir el writer para calcular su expected.

Tupla exacta: MachineProfile@revision + OutputCompatibilityProfile@revision + adapter@version/digest. Emitir programa por pieza/montaje, salvo reutilización por equivalencia técnica completa demostrada; conservar el mapping de todas las ocurrencias físicas. Nombres/etiquetas compatibles con el receptor, deterministas y sin colisiones por truncado, Unicode, case-folding o directorio. No imponer 8.3 sin evidencia. Una etiqueta apunta al conjunto correcto de programas/setups; `cncDrawingRef` de #789 no prueba por sí solo que exista un programa válido. Manifest conserva referencia industrial y UUID interno, sin exponer PII o rutas privadas.

Manifest: release/R y manufacturingFingerprint exactos, ocurrencias y cantidades, etapa geométrica, setups/operaciones cubiertas, filenames/hashes, perfiles/adapter/digests y referencias de tooling/evidencia donde correspondan. No sobrescribir nombres históricos ni resolver latest al abrir una revisión. Copias geométricamente iguales con maquinado distinto no comparten programa. Referencias externas/subprogramas sólo si están fijados, disponibles y validados; ninguna dependencia de macros locales desconocidas.

Reutilizar Config de salida #591 y workspace #503: HPP250 para corte y BHX050 para CNC tienen selecciones distintas. Política de construcción #875 es otra responsabilidad. UI distingue loading/error/confirmed-empty/configured/blocked/stale, implementación, candidato de prueba y validación física. Selección BHX bloqueada NO cae a DXF/PTX/genérico; DXF sigue disponible como elección explícita independiente, nunca éxito sustituto. Descargar o cargar no marca ejecución física ni stock. Lote solicitado completo se valida antes de publicarse; un subconjunto requiere solicitud/alcance explícito, no omisión silenciosa. Tenant/session y respuestas tardías conservan los guards existentes.

## B6. Secuencia de implementación y fronteras

**Primero contrato y fixtures:** revalidar dossier, fuentes/macros exactas, muestras saneadas, mapa de consumidores y blockers específicos. **Después candidato offline:** planner/adaptador y readback independiente sobre el subconjunto con evidencia de interfaz. No exige cerrar todo #348/#352/#354 ni esperar toda #874 para usar fixtures neutrales válidos; sí exige no inventar el formato que falte. **Luego integración:** entrada congelada #739, selección #591 y entrega #503 con manifest/etiquetas #789. La prueba completa desde recetas reales consume sus hitos y no crea dependencia circular con sus tests.

**Validación de instalación separada bajo #352:** importación con la versión real, inspección semántica/readback, generación NC y simulación con la configuración OEM disponible; después prueba física controlada por operador cualificado y protocolo del fabricante. Abrir el programa no demuestra que genere NC, que sea ejecutable o que el resultado físico coincida. Cada claim tiene perfiles, hashes, límites y evidencia propia. Pruebas de HPP250/CADLink o DXF no promueven BHX. No imponer una licencia/simulador opcional inexistente ni sustituir evidencia requerida por un mock.

Primera entrega es por archivos/descarga revisada. Sin PLC, arranque remoto, cambios de seguridad ni escritura a carpetas productivas vigiladas; tampoco instalación/actualización del control. Una transferencia automática posterior necesita alcance y controles propios. Conservar writers de #676/#873 y no introducir refactors de plugin/PTX/optimización en esta issue.

## B7. Aceptación rastreable

| ID | Prueba requerida | Capa / owner |
|---|---|---|
| BHX01 | Modelo confirmado separado de versión/tooling/formato pendientes y evidencia con localizadores | Dossier #352 / contrato #879 |
| BHX02 | Bytes reconstruyen piezas y operaciones exactas con lector independiente | Adapter #879 |
| BHX03 | Rectángulo asimétrico, seis caras, inversa y no heredar giro/espejo DXF | Planner #879 |
| BHX04 | Pares canto–cara, patrón compuesto/minifix y procedencia correctos o bloqueo | #874 + #879 |
| BHX05 | Herramienta, espesor, tamaño, cara o pinza no admitidos bloquean antes de salida | Perfil/planner #879 |
| BHX06 | Montajes/reorientación preservan cobertura sin duplicados; no soportado falla | #879 / confirmación #352 |
| BHX07 | Fallo BOM/perfil/operación faltante no se convierte en lote completo o fallback | Integridad #879, principio #676 |
| BHX08 | Copias, códigos y barcode mapean a revisión/programas/setups exactos | #789 + #879 |
| BHX09 | Snapshot/tupla exactos, tenant y descarga/pack; sin catálogo live ni latest | #739/#591/#503 + #879 |
| BHX10 | Determinismo/digests/pins, paridad y mutantes cara/eje/profundidad/omisión | #879 |
| BHX11 | Browser/backend aplicables y estado honesto, no sólo mocks | #879/#503 |
| BHX12 | Import/readback, generación NC, simulación y pieza física distinguidos | #352; consumo #354 |

## B8. Handoff y definición de entrega

Retomar por #879 y este documento; leer los contratos exactos, revalidar main/PRs/approval/reservas y tomar un incremento acotado. Publicar HEAD/base, fuentes y fixtures, soporte/blockers por operación, revisión independiente y CI. #879 puede cerrar la implementación técnica del subconjunto completo acordado con pruebas internas y límites; eso NO cierra #352 ni permite afirmar BHX homologada sin su evidencia. Lo no ejecutado es NOT_RUN/BLOCKED, no PASS. No generar números de producción, márgenes de seguridad o capacidades a partir de modelos parecidos. Este documento conserva decisiones; GitHub sigue siendo la cola operativa y la configuración del taller permanece en su dossier versionado.
