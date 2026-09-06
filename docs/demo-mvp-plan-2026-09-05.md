# Granete — Camino verificable de DEMO a MVP

**Fecha local:** 2026-09-05, America/Mexico_City.  
**Decisión:** primero reconciliar documentación; después ajustar issues existentes.  
**Alcance de esta entrega:** documentación únicamente; no cambia código, ledger ni GitHub.

La siguiente entrega no es reconstruir lo que ya existe: es **hacer visible y ensayar el
hilo completo**, cerrar los riesgos de las rutas usadas y cualificar la fabricación
para los dos primeros clientes potenciales. Este plan ordena el PRD y el roadmap;
no reemplaza los contratos de dominio ni certifica una DEMO ejecutada en esta sesión.

## 1. Cómo leer el estado

| Etiqueta | Qué permite afirmar |
|---|---|
| Integrado | PR fusionado en el main consultado; no implica todos los consumidores ni prueba física. |
| Issue cerrada | Estado GitHub verificado; su alcance/evidencia se conserva, no se amplía retrospectivamente. |
| PR abierta / local | Trabajo aprovechable aún fuera de main; no contarlo como entregado. |
| Pendiente | Criterio abierto documentado; revisar código y PR antes de implementar. |
| Propuesto | Dirección incorporada del review, aún sin contrato/implementación completos. |
| Evidencia física pendiente | No existe aquí prueba suficiente para prometer compatibilidad productiva. |

**Corte remoto:** `587961fd379b64cc27288d8de1a1118b50032a23`, merge de
[PR #564](https://github.com/tiagofur/muebleria/pull/564), 2026-09-05 19:08:46 UTC.
Consulta GitHub: 2026-09-06 00:06 UTC, todavía 5 de septiembre local.
Para no perder las foundations previas a los últimos tres días, se amplió la ventana a
**2026-09-02 UTC hasta esa consulta: 29 PRs fusionadas y 18 issues cerradas**.
Estos son conteos del corte, no estadísticas permanentes del producto.

**Readback de publicación posterior:** [PR #565](https://github.com/tiagofur/muebleria/pull/565)
se fusionó el 2026-09-06 00:29:02 UTC (5 de septiembre local), merge
`3a8f12aa22a8a500797a1318c9c28bf580bd2004`; [issue #500](https://github.com/tiagofur/muebleria/issues/500)
se cerró a las 00:29:03 UTC. Los conteos y la tabla histórica anteriores se conservan
como snapshot inicial; el próximo paso vigente es #501 y después #502, reutilizando
la matriz de unidades físicas integrada. Esta actualización no certifica la DEMO
completa ni compatibilidad física de máquinas.

## 2. Evolución reciente que se debe conservar

Cada número enlaza a la evidencia remota; la fecha de la primera columna es UTC.

| Fecha | Entregas fusionadas | Alcance que no se debe reiniciar |
|---|---|---|
| 2 sep | [#532](https://github.com/tiagofur/muebleria/pull/532), [#533](https://github.com/tiagofur/muebleria/pull/533), [#534](https://github.com/tiagofur/muebleria/pull/534), [#535](https://github.com/tiagofur/muebleria/pull/535) | Credenciales web en memoria, sesiones móviles, enrollment SketchUp y MFA/step-up; no son pairing Project/Design #499. |
| 2 sep | [#536](https://github.com/tiagofur/muebleria/pull/536), [#537](https://github.com/tiagofur/muebleria/pull/537) | Slice de auditoría crítica atómica y Gate A ejecutable, con evidencia reportada 34/34. #462 sigue abierto por Gate B. |
| 3 sep | [#538](https://github.com/tiagofur/muebleria/pull/538), [#539](https://github.com/tiagofur/muebleria/pull/539), [#540](https://github.com/tiagofur/muebleria/pull/540) | #385 FurnitureInstance estable, #386 cantidades comerciales → unidades físicas, #387 Design/revisiones. |
| 3 sep | [#541](https://github.com/tiagofur/muebleria/pull/541), [#542](https://github.com/tiagofur/muebleria/pull/542), [#545](https://github.com/tiagofur/muebleria/pull/545) | #388 binding, #389 panel/place y corrección de confirmación/sincronización working copy. |
| 3 sep | [#544](https://github.com/tiagofur/muebleria/pull/544) | #543 corrección de overrides de componentes en estructura 3D. |
| 3 sep | [#546](https://github.com/tiagofur/muebleria/pull/546), [#547](https://github.com/tiagofur/muebleria/pull/547) | Inserción design-first y resolución de duplicados; #390/#391 continúan abiertos: alcance/cierre por reconciliar. |
| 4 sep | [#548](https://github.com/tiagofur/muebleria/pull/548), [#549](https://github.com/tiagofur/muebleria/pull/549), [#550](https://github.com/tiagofur/muebleria/pull/550), [#551](https://github.com/tiagofur/muebleria/pull/551) | #392 publicación/artifacts, #393 reconciliación exacta, #394 impacto/requote explícito, #395 aprobación/release exacto. |
| 4 sep | [#553](https://github.com/tiagofur/muebleria/pull/553), [#554](https://github.com/tiagofur/muebleria/pull/554) | #552 auditoría histórica y #398 regresión Digital Thread; backend/contratos/host no equivalen a navegador→máquina completo. |
| 4 sep | [#555](https://github.com/tiagofur/muebleria/pull/555), [#556](https://github.com/tiagofur/muebleria/pull/556), [#557](https://github.com/tiagofur/muebleria/pull/557) | #498 runtime compartido; #468 edición de herrajes y corrección de autoridad de placements. |
| 5 sep | [#558](https://github.com/tiagofur/muebleria/pull/558), [#559](https://github.com/tiagofur/muebleria/pull/559), [#562](https://github.com/tiagofur/muebleria/pull/562) | Overlay #470 — issue abierta; #466 preflight/navegación y #467 autoría interna — issues cerradas. |
| 5 sep | [#561](https://github.com/tiagofur/muebleria/pull/561), [#564](https://github.com/tiagofur/muebleria/pull/564) | #560 reconciliación RLS de devices y #563 enrollment resiliente. |

Las **18 issues cerradas** en esta ventana son #385, #386, #387, #388, #389, #543,
#392, #393, #394, #395, #552, #398, #498, #468, #560, #466, #467 y #563.
Los PRs correctivos pueden no cerrar una issue; no existe equivalencia uno a uno.

### Estado inicial y actualización de publicación

| Autoridad | Estado (corte inicial salvo readback indicado) | Consecuencia |
|---|---|---|
| [#500 / PR #565](https://github.com/tiagofur/muebleria/pull/565) | Integrada en readback de publicación; issue cerrada | Reutilizar la matriz de unidades físicas y continuar #501, después #502; no reimplementarla. |
| [#496](https://github.com/tiagofur/muebleria/issues/496) | Abierta | El slice generado de #565 no completa toda la API canónica. Ampliar la autoridad existente, no crear DTOs paralelos. |
| [#501](https://github.com/tiagofur/muebleria/issues/501), [#502](https://github.com/tiagofur/muebleria/issues/502) | Abiertas | Historial/artifacts y reconciliación/requote/aprobación web; reutilizar backend y modal de release existentes. |
| [#497](https://github.com/tiagofur/muebleria/issues/497), [#499](https://github.com/tiagofur/muebleria/issues/499) | Abiertas | Administración tipada y pairing exacto; enrollment de dispositivo no es handoff de proyecto. |
| [#390](https://github.com/tiagofur/muebleria/issues/390), [#391](https://github.com/tiagofur/muebleria/issues/391), [#470](https://github.com/tiagofur/muebleria/issues/470) | Abiertas con PRs fusionadas | Reconciliar criterios y evidencia antes de cerrar o asignar más implementación. |
| [#462](https://github.com/tiagofur/muebleria/issues/462) | Abierta; Gate A integrado | Gate B no se presume aprobado. No volver a bloquear el Digital Thread existente como si Gate A no hubiera ocurrido. |
| [#460](https://github.com/tiagofur/muebleria/issues/460), [#461](https://github.com/tiagofur/muebleria/issues/461) | Abiertas parcialmente entregadas | Conservar SEC-8/9 y timeline/observabilidad pendientes, sin negar la foundation de Gate A. |

## 3. DEMO: un recorrido, no un inventario de pantallas

**Resultado objetivo:** una persona puede seguir una misma obra y entender qué se vendió,
qué cambió, qué revisión se fabricaría y qué falta. La DEMO no promete fabricar piezas
con una ruta aún no cualificada.

1. **Cotizar:** catálogo de referencia existente, materiales/precio y una línea con
   cantidad mayor a uno; identificar cada FurnitureInstance sin mezclar identidades.
2. **Diseñar:** abrir el modelo asociado y colocar/editar una unidad en SketchUp;
   conservar unidades no editadas. Handoff manual explícito si #499 sigue pendiente.
3. **Mostrar la diferencia técnica:** mover un entrepaño/herraje, provocar un conflicto,
   navegar al origen y corregirlo; ready sólo tras preflight vigente. Undo y reapertura
   conservan geometría, metadata e identidad.
4. **Publicar y decidir:** R1/R2, artifacts y diferencias visibles en web; requote
   explícito cuando aplica; aprobación y release fijan la revisión exacta. R2 no
   modifica una liberación R1 ni hereda su aprobación.
5. **Continuar la obra:** BOM/despiece → disponibilidad/faltantes → producción por
   piezas → armado por unidad → instalación. Mostrar límites reales de cada conexión;
   una pantalla con datos de muestra no prueba transferencia ni transacción end-to-end.
6. **Salida industrial:** mostrar únicamente el formato/ruta ensayados y su informe de
   cobertura. Si no hay readback físico, decir “salida preparada, validación pendiente”.

### Orden mínimo de preparación

| Paso | Trabajo | Condición de salida |
|---|---|---|
| D0 | Reconciliar este plan y luego las issues, sin duplicar entregas | Cada gap tiene autoridad existente, evidencia y alcance. |
| D1 | Reutilizar #500/#565 integrado; completar #501 y después #502 | Navegador con Go/PostgreSQL real muestra unidades/revisiones/decisiones; no consola oculta para contar la historia. |
| D2 | Congelar biblioteca y guion conocidos | Reutilizar `MOD-GAB-01`, `MOD-CAJ-01`, `MOD-COMP-001` del reporte de readiness, verificando sus revisiones/datos antes del ensayo. No seed de negocio implícito. |
| D3 | Ensayar host, web y continuidad operacional | Evidencia nueva sobre SHA exacto; fallos, stale, retry y regreso al estado válido incluidos. |
| D4 | Aceptar alcance mostrado y declarar exclusiones | Sin pérdida silenciosa en rutas expuestas; no claim de máquina por exportar un archivo. |

El [reporte anterior de readiness](demo-golden-path-readiness-20260905.md) describe un
**guion SketchUp-céntrico condicionado**, con mitigaciones y evidencia de su snapshot.
Su “0 blockers” no certifica el alcance ampliado de esta DEMO, las superficies React
pendientes, todos los exports ni un MVP productivo. Se conserva sin reescribir sus
resultados. Tampoco se reabre #398: su proof es un activo que esta aceptación amplía.

## 4. Incorporación del review: prioridad por exposición y riesgo

Fuente inmutable: [anexo de revisión del 5 de septiembre](Granete_review_plan_ejecucion_2026-09-05.md).
Sus hallazgos se fijan al SHA revisado; su lectura estática no es una ejecución física.
Los defectos reproducidos por el reporte de readiness se atribuyen a ese reporte, no a
esta actualización documental. Un nuevo contrato propuesto no significa código nuevo.

| Review | Qué se conserva / qué falta | Tratamiento DEMO → MVP y autoridad existente |
|---|---|---|
| RV-01 | Resolver Go existente, cobertura de relaciones/recetas limitada | Recetas versionadas administrables sobre el motor actual; #496/#497 + contratos de biblioteca/manufactura. DEMO usa combinaciones conocidas; ampliar por caso piloto. |
| RV-02 | Tabla compilada de maquinados manuales; ausencia puede devolver cero operaciones | Antes de presentar una combinación como fabricable, distinguir `not_required`, `configured`, `missing`, `unsupported`; falta obligatoria bloquea. Estados propuestos, no enum ya implementado. |
| RV-03 | Perfiles TS y Go existentes no equivalentes | Inventariar consumidores y paridad compartida; no tercera tabla/motor ni asumir que Go verde arregla exports legacy. |
| RV-04 | Preview de agregados existe, pero excluye herrajes | Completar proyección común con pertenencias/assets/diagnósticos; no reemplazar los editores actuales para la primera DEMO. |
| RV-05 | Render procedural existe; formas ausentes pueden no dibujarse | Proxy/ausencia visibles; separar representación, receta y validación. GLB/SKP ligados a revisión y manifiesto para catálogo piloto. |
| RV-06 | DXF rotado omite perforaciones; reproducido en readiness | Corregir transformación o bloquear salida incompleta **antes de usar esa ruta**. Excluirla explícitamente de DEMO si no está resuelta; obligatorio antes de producción que la requiera. |
| RV-07 | Resolver TS con contexto/joins/caché insuficientes; usado por exports reales | Identidad física y contexto completo; probar opciones/medidas distintas e inversión del orden. No llamarlo inocuo porque el preflight Go es correcto. |
| RV-08 | Payload legacy pierde fallback/problemas | Conservar procedencia/severidad hasta export o bloquear ruta que no puede preservarlas. Comparar operaciones y diagnóstico, no sólo EOF/archivo existente. |
| RV-09 | Picking/descuento no atómicos en orquestación web | Comando backend transaccional/idempotente, fallo entre pasos y retry. Happy path de demo no cualifica stock real. Reutilizar compras/almacén; no nuevo sistema de inventario. |
| RV-10 | Plantilla pierde parte de kitchenLayout | Contrato de copia/referencia/regeneración + roundtrip multiespacio. No copiar identidad física/release. Fuera del guion sólo mediante exclusión visible; obligatorio si el piloto usa plantillas. |
| RV-11 | Backend no equivale a autoría tipada/flujo empresarial web | #497, #396/#500/#501/#502 y #499; #565 se aprovecha como entrega integrada en el readback de publicación, no trabajo ausente. |
| RV-12 | Snapshots de catálogo y concurrencia por entidad pendientes | #443; conflictos/versiones explícitos y prueba de dos editores. BroadcastChannel invalida vistas, no evita pérdida de escrituras. |
| Riesgo adicional | Invalidación de preflight Ruby puede rescatar excepción | **Riesgo por comprobar**, no exploit ni falso ready reproducido. Inyectar fallo con consumidores #498/#466: jamás reutilizar validación anterior como vigente. |

### Ideas incorporadas sin ampliar silenciosamente la primera DEMO

- **Herraje industrial:** alta/edición, visualización y banco de prueba con una o dos
  piezas, cara de entrada, espesor y operaciones. No inferir maquinado desde una malla.
- **Ensamble lateral–piso:** extender `PartRelationship`; maquinado independiente por
  pieza y política explícita — ambas piezas, sólo lateral o receta de taquete.
- **Cajón de madera → sistema box:** receta de Agregado cambia piezas, comprados,
  perforaciones y costo conjuntamente. `Simular → diferencias → confirmar → aplicar
  atómicamente`; conservar identidades de piezas que permanecen.
- **Frente con perfil:** distinguir envolvente, panel neto, perfil, tapas, holguras,
  longitud de compra y desperdicio. Perfil sobre frente no es gola del casco.
- **3D coherente y presentación:** completar escena existente, no multiplicar visores;
  #529 conserva pose industrial cerrada y diferencia actor fijo/móvil. Abrir un cajón
  no cambia BOM ni certifica colisiones mecánicas. #444 requiere WebGL real.

Diámetros, distancias, compatibilidades y límites de recetas provienen de fichas técnicas
verificadas y pruebas del taller, nunca de ejemplos inventados. Estas mejoras compiten
por los trabajos reales de los dos prospectos; no todas son prerrequisito del primer guion.

## 5. MVP vendible: dos paquetes de cliente independientes

**No están confirmados en este plan** los nombres, modelos de máquina, controladores,
versiones de software ni criterios comerciales de los dos clientes potenciales.
Las authorities existentes son [#352 cliente A](https://github.com/tiagofur/muebleria/issues/352)
y [#353 cliente B](https://github.com/tiagofur/muebleria/issues/353). Un resultado de A no
certifica B, aunque compartan marca o formato.

| Entrega por cliente | Información/evidencia requerida | Estado en este plan |
|---|---|---|
| Trabajo vendible | Familia de muebles, flujo prioritario, volumen esperado, dolor, alcance pagable y criterio de aceptación | Por confirmar con cada prospecto; no inventar precio ni venta. |
| Biblioteca mínima | Materiales/espesores/herrajes/recetas reales, variantes y ficha técnica | Seleccionar/reutilizar catálogo y validar combinación. |
| Dossier de máquina | Máquina, controlador, software/versión, formatos, ejes, caras, herramientas, sujeción, restricciones y muestra sanitizada | Evidencia de campo pendiente. |
| Paquete industrial | Release/DesignRevision/fingerprint, perfil/revisión, adaptador/versión/digest, archivos y cobertura | Cualificar sobre la ruta concreta, sin omisiones silenciosas. |
| Readback y pieza | Importación esperada vs obtenida, informe, operador y prueba física segura | Pendiente; fallo/partial/unsupported permanecen explícitos. |
| Operación diaria | Reintentos sin duplicación, conflictos sin pérdida, permisos, recuperación, instalación/update/rollback y soporte | Pruebas de aceptación por cliente, no sólo suites de helpers. |
| Resultado comercial | Uso del ciclo acordado, tareas sin ayuda, calidad/tiempo y disposición a pagar | Medir en piloto; no presentar metas como resultados. |

### Cadena de integración que no se debe saltar

[#348](https://github.com/tiagofur/muebleria/issues/348#issuecomment-5426343830)
conserva el bloqueo de evidencia de campo;
[#351](https://github.com/tiagofur/muebleria/issues/351#issuecomment-5426340769)
tiene discovery arquitectónico, no implementación productiva completa.

```text
dossier y prueba de ruta #348
→ implementación MachineProfile/PostprocessorAdapter #351
→ evidencia independiente #352 / #353
→ operaciones web y artifacts #503
→ gate host/salida física #354
→ packaging y soporte #355
```

Puede prepararse documentación/fixtures sin afirmar que el bloqueo desapareció.
Descarga/importación manual verificable es una integración inicial válida si satisface
el trabajo del cliente; automatizar transferencia se decide después y no sustituye
readback ni operación segura. DXF por capas/PTX son rutas a validar, no compatibilidad
por marca. No construir un agente local de envío sin necesidad, consumo y recuperación.

El MVP no requiere “todo el ERP” ni todo Gate B para un flujo monofábrica; sí conserva
Gate A y las defensas aplicables. Si el caso vendido incluye colaboración cross-org,
publicaciones u órdenes entre organizaciones, debe satisfacer Gate B antes de ofrecerlo.

## 6. Criterios de salida y siguiente sesión

**DEMO aceptada:** recorrido ensayado sobre SHA exacto, web/host reales en las capas
mostradas, fixtures/versiones explícitos, incidencias y exclusiones visibles. Ninguna
pérdida silenciosa está escondida por el guion. Sin afirmación física más allá de evidencia.

**MVP aceptado por cliente:** tareas acordadas repetibles, integridad ante fallo/retry/
concurrencia, biblioteca técnica suficiente, máquina/software cualificados, soporte y
recuperación comprobados. Un piloto asistido se declara asistido hasta validar autonomía.

**Próximo paso autorizado por separado:** reconciliar GitHub con esta matriz. Primero
leer PRs y criterios de #390/#391/#470 y #500/#565; después ajustar alcance/dependencias
existentes para los RV y las etapas. No cerrar por similitud de título, no duplicar issues
ni empezar una segunda feature por tomar el menor ID pendiente del ledger.

Fuentes complementarias: [PRD](prd-v2.md), [roadmap](roadmap-comercial-v2.md),
[Operational Core](operational-core-v1.md), [contrato de integración](architecture/sketchup-backend-web-integration-excellence.md),
[auditoría histórica](muebles-audit-360-20260903/audit/README.md).


## Verificación de esta actualización documental

Se contrastaron issues/PRs remotos, los documentos fuente y consumidores de código
seleccionados. Las pruebas citadas en reportes/PRs pertenecen a esas ejecuciones y no
se convierten en tests realizados por esta actualización. No se ejecutó aquí un ensayo
SketchUp, navegador→máquina ni prueba física.

`./init.sh` se intentó, incluido un reintento serializado de Go. No se obtuvo un gate
general verde: PostgreSQL compartido presentó agotamiento de conexiones y, en el
reintento, terminación administrativa/autenticación de roles de prueba
(`SQLSTATE 57P01` / `28P01`). No se cambiaron código ni configuración para resolverlo.
Este resultado no certifica ni invalida por sí solo la DEMO; requiere entorno de prueba
controlado cuando se autorice la siguiente implementación/rehearsal.
