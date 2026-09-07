# Software Factory — estado operativo

**Estado: entrega parcial de #573. No hay autonomía de implementación demostrada
ni DEMO FREEZE.** GitHub Issues es la única cola operativa. Este informe registra
evidencia y límites; no aprueba issues, no autoriza merges y no reemplaza al líder.

## Modo vigente — inicio humano (2026-09-07)

El propietario autorizó adaptar las skills a [propuesta → aprobación → ejecución
acotada → PR revisado](software-factory-human-start.md), con merge humano.
El heartbeat `Granete — auditoría y coordinación demo` fue pausado por el líder;
no reactivarlo automáticamente. La política local discovery y la cuarentena de
#577 permanecen intactas. Este cambio no elimina ese bloqueo de ownership ni
habilita el implementador del runtime. No hay un canary nuevo de producto probado.
Los gaps históricos siguientes siguen abiertos; el objetivo inmediato se acota a
PR verificable, no merge autónomo ni cierre automático de #573.

## Autoridad y operación existente

- Alcance: [#573](https://github.com/tiagofur/muebleria/issues/573).
- Roles: [leader](../../.agents/skills/leader/SKILL.md),
  [implementer](../../.agents/skills/implementer/SKILL.md) y
  [reviewer](../../.agents/skills/reviewer/SKILL.md).
- Publicación y handoff: [verificación](../verification.md), entregas
  [#574](https://github.com/tiagofur/muebleria/pull/574),
  [#575](https://github.com/tiagofur/muebleria/pull/575) y
  [#576](https://github.com/tiagofur/muebleria/pull/576).
- Un solo coordinador local, utilizado por la tarea programada
  `Granete — auditoría y coordinación demo`, cada cuatro horas, en discovery.
  Work puede dirigir al líder, pero no constituye un segundo dispatcher.

El controlador instalado y su README se encuentran en
`/Users/tiagofur/Documents/Codex/2026-09-06/referenced-chatgpt-conversation-this-is-an/outputs/granete-factory`.
Su único estado está en `runtime/`; no copiarlo al repositorio ni crear otro estado
predeterminado al versionar el controlador. Los informes completados son inmutables.
`feature_list.json` conserva su función de ledger, no de cola de asignación.

## Evidencia comprobada — 2026-09-07 UTC

| Componente | Evidencia | Límite |
| --- | --- | --- |
| Publicación y handoff exacto | #574/#576 integradas | No demuestran dispatch ni permiso de merge |
| Reserva, cuarentena, recuperación y resultados tardíos | Controlador actualizado; 87 pruebas instaladas y 8 pruebas independientes PASS | El hash declarado de un resultado no acredita sus bytes |
| Binding persistente v5 de worktree/PR | Prueba real con #573/PR #580 y lectura tras reinicio PASS en estado desechable; rechazo de base desactualizada con #577/#579 | No hubo canary completo de dispatch; runtime activo continúa v1, sin reservas nuevas |
| Preflight del producto | `./init.sh` PASS, PostgreSQL desechable, sobre `6ae788aed6e5be6263462b8995ec6197352aa5a0`, árbol equivalente a `84c98698d9dab023ae9427ebdac98c63ef5d1236` | No acredita automáticamente el main posterior |
| PR #579 | Ocho controles PASS sobre `191ee7f49527009bcae134566af2902598d1914f`; merge externo `78116f20d2dec0fb50290811b128bd55dc814383` | No fue un merge realizado por esta fábrica; #577 sigue abierto |
| Protección remota | Consulta: main sin protección, rulesets vacíos | CI verde no es enforcement; no se cambiaron permisos |
| CI post-merge #579 | [Run 34074800002](https://github.com/tiagofur/muebleria/actions/runs/34074800002): Go Backend Tests FAIL, timeout global de almacenamiento a los 10 minutos | Main `78116f20d2dec0fb50290811b128bd55dc814383` no está verde; no se atribuye una causa raíz sin reproducción |

Durante la prueba de observación, main cambió por el merge externo de #579.
La base anterior fue rechazada. Esa evidencia prueba rechazo de obsolescencia,
no dispatch de implementación ni aprobación independiente de una entrega.

La instalación v5 conserva hashes del estado, política e informes completados.
Controlador SHA-256: `11e8fbca9749b623079a7b9e81826589a6bcb59f313622405337d6214004c5a1`.
Es una entrega local del controlador existente, no código publicado por este PR
documental. El binding se obtiene de una observación nueva bajo el mismo bloqueo;
no acepta un digest del solicitante como prueba. No libera ni autoriza la reserva.
La prueba real fijó PR #580 a `22bcb8edc42dea338856ac32bd805b8a7604937d`;
cualquier commit posterior requiere un binding y una validación nuevos.

## Gaps de ejecución que mantienen #573 abierto

1. Persistir asignación de agentes y consumir bytes verificables de evidencia
   independiente. El binding exacto ya se conserva, pero no sustituye esos pasos.
2. Conectar el líder con reviewer → implementer → validator independiente,
   registrando intento, identidad de agente, timeout y lanzamiento incierto.
3. Seleccionar modelos por riesgo/complejidad y capacidad suficiente. Separar modelo
   solicitado de modelo realmente observado; registrar `unavailable` cuando la
   plataforma no exponga el segundo. No afirmar costos o ahorros sin medición.
4. Exigir CI vigente para HEAD/base exactos, autorización humana de merge y
   lectura final. Preparar protección no equivale a activarla ni verificarla.
5. Incorporar cierre normal tras merge y re-evaluación: el controlador actual
   trata cambios de main como drift; no usar recuperación de crash como éxito normal.
6. Demostrar canary completo aprobado, incluida validación independiente, merge
   autorizado y post-merge. Hasta entonces, no activar correcciones autónomas.

La reserva limita a un escritor, retiene cuarentena y conserva dos intentos por
issue. Los claims de discovery tienen sus propios límites; no deben presentarse
como límites ya implementados para agentes de producto. Receipt-driven permanece
`disabled/unmanaged`; la validación independiente solicitada no lo activa.

## Próximo producto, después de probar la fábrica

Releer [#577](https://github.com/tiagofur/muebleria/issues/577) y
[#579](https://github.com/tiagofur/muebleria/pull/579), comprobar CI post-merge y
repetir el [golden-path rehearsal](demo-golden-path-rehearsal-20260906.md).
Un PR integrado no prueba por sí solo BOM liberada inmutable ni cierra todo el P0.
No iniciar #499 u otra feature antes de resolver el P0 y reevaluar el rehearsal.

Crear nuevas issues automáticamente solo para hallazgos `demo:blocker` o
`demo:required`, previa deduplicación y sin autoaprobación. P2/P3, mejoras visuales
y extras van al [reporte secundario](demo-secondary-findings.md).

## Condición de DEMO FREEZE

Exigir golden path end-to-end PASS; P0=0; mitigaciones manuales no aceptadas=0;
sin SQL/direct DB runtime ni doble release legacy; ProductionRelease con provenance
exacta hacia BOM, almacén y producción; Web↔SketchUp profesional cuando esté en
alcance; hardware/machining representativo; CI y rehearsal verdes. Entonces permitir
solo blockers, regresiones y polish de bajo riesgo. MVP/extras permanecen fuera.

## Máquinas: solo discovery/evidence

Weeke BHX 050 y Holzma HPP 250 son dos máquinas de un cliente, no compatibilidad
certificada. Reutilizar #348 → #351 → #352/#353 → #503/#354/#355.
Controlador, software, versiones, configuración e import/readback físico sin
evidencia del cliente permanecen `FIELD_VERIFICATION_REQUIRED`. No asumir versiones
de woodWOP/CADmatic, implementar CAM universal ni desplazar el cierre de DEMO.
