Closes #1535
Delivery: complete

## Type
- [x] New feature — `type:feature`

## Summary
El Inspector de SketchUp gobierna el agarre como ADR-0009 Enmienda 1 manda: **sin selección**, una sección «Agarre del proyecto» con las filas de los estilos que el taller ofrece (nombre, opción marcada, «Predeterminado»); un clic manda la intención al servidor con If-Match del agarre del proyecto y queda deshacible (re-PUT de la intención previa dentro de la sesión). **Con un mueble seleccionado**, la tarjeta «Agarre» dice «Usa el estilo del proyecto: {nombre}» verbatim del snapshot congelado, muestra el resultado en palabras del taller compuesto desde el reporte del servidor (alturas A3 y modos por posición — el plugin nunca calcula), y ofrece «Cambiar sólo este mueble» / «Volver al del proyecto». **Con varios muebles**, el bloque del lote aplica N excepciones en UNA operación. Se retiran las dos tarjetas duplicadas «Apertura del diseño» con su módulo y el transport muerto de la fachada `/designs/{id}/opening`; «Apertura y presentación» vuelve a «Apertura» (§14.7: el vaivén y la presentación). El backend agrega el código GRIP_* en `details.reason` del 422 para que el mapa del taller del plugin nombre acción y lugar. Estado indexado por proyecto: una respuesta tardía de otro proyecto o con requestId vencido se descarta sin renderizar. RBZ 0.1.108.

## Decisions made without asking
- Deshacer/Rehacer = re-PUT de la intención previa/siguiente guardada en la sesión del bridge (el servidor es la verdad; SketchUp operations no revierten escrituras remotas) — suposición 1 del brief aprobado.
- La oración de resultado usa lo que el GET reporta (alturas, descuentos, modos); los anchos y cantidades de BOM del ejemplo de la issue exigen ampliar el reporte server-side y quedan para #1536/follow-up — suposición 2 del brief.
- El bridge rechaza en origen un `projectId` ajeno al binding (`stale_binding`) y el módulo JS además descarta por proyecto + requestId (doble llave para respuestas tardías).
- `Model#delete_attribute` no borra en el host: el «sin binding» viaja como cadena vacía, que el store ya trata como ausencia (quirk hallado en el host run).
- El transport muerto de la fachada se retira con sus tarjetas; los accessors compartidos (`design_opening_placer` / `design_opening_binding_store`) migran al geometry bridge que los comparten sync/canal/project-furniture.

## Changes
| File | Change |
| --- | --- |
| `backend-go/internal/api/project_grip.go` | El 422 de grip lleva `details.reason` con el código GRIP_* (mismo envelope que la fachada). |
| `ui/bridges/project_grip_bridge.rb` (nuevo) | Transporte de intenciones: GET/PUT estilo, PUT excepciones (N en una op), undo/redo por sesión; ProjectGripSessionState (stacks + última versión If-Match por proyecto); rechazo de proyecto ajeno. |
| `connection/project_furniture.rb` | Métodos HTTP de grip con `If-Match: "v<n>"` y el 412 tipado (antes caía a «respuesta inesperada»). |
| `resources/js/granete-grip.js` (nuevo) | Estado por proyecto, tres superficies, oración del taller, mapa GRIP_* en español, banner 412 «Recargá y volvé a aplicar», radiogroup + aria-live. |
| `dialog.html`, `granete-inspector.js`, `granete-design-inspector.js` | Shells nuevos, cableado por carril (diseño/mueble/lote), retiro de tarjetas A/B, renombrado de C. |
| `granete-opening.js`, `design_opening_bridge.rb` (+tests) eliminados | La fachada de apertura muere con #1535 tal como su propio comentario anticipaba. |
| `identity.rb` | RBZ 0.1.108. |
| `test/js/granete_grip_test.js` (11), `granete_grip_js_test.rb`, `TC_ProjectGripSmoke.rb`, harness/registro al día | Pruebas de los 6 estados + tardías + intenciones; humo en host real. |

## Test evidence
Revisión exacta: `d2c18375` (HEAD final, base `8b621c85`).
- Ruby: `rake unit` → 1478 corridas / 10678 aserciones / 0 fallos; `rubocop` → 0 ofensas; `rake verify` → verde con RBZ 0.1.108 firmado.
- JS: `granete_grip_test.js` 11/11 (estados hereda/excepción/varios/bloqueado/sin conexión/desactualizado, tardías por proyecto, intenciones, oraciones); harness del inspector 54/54.
- **Host real (SketchUp 2026, RBZ 0.1.108 instalado)**: `TC_ProjectGripSmoke` vía `TestUp::API.run_suite_without_gui` → **5 corridas / 20 aserciones / 0 fallos** — intención de estilo sin selección con If-Match y deshacer/rehacer, excepción de 1 y de 3 muebles en una operación, proyecto ajeno rechazado (`stale_binding`), modelo sin vincular con el motivo del taller.
- Backend: `go test` domain/engine/api/storage ok.
- CI en el HEAD final: run 42715745084 — resultado al abrir el PR.

## Visual Evidence
Brief aprobado: https://github.com/tiagofur/muebleria/issues/1535#issuecomment-6749341728
N/A (plugin sin capturas de host en este PR; el humo del host queda evidenciado por TC_ProjectGripSmoke y el vivo del dialog con servidor real corre en la verificación del owner junto con #1536, tal como el artefacto odd/tasks/1535-inspector-agarre.md registra).

## Risk
Risk: item 1 (el deshacer del estilo del proyecto re-emite intenciones de sesión: si el bridge recarga entre aplicaciones la pila se pierde — el botón Deshacer desaparece honestamente y la verdad queda en el servidor). Mitigación: el GET re-arma la versión y el estado; probado en host. Risk item 2 (retiro de la fachada `/designs/{id}/opening` en el PLUGIN: el GET legacy sigue en el servidor para transición pero ningún cliente del plugin lo llama). Mitigación: grep cero de referencias JS/Ruby; el harness y el registro de callbacks al día.

## Clean-context review handoff
- Base SHA: `8b621c85` (ver bundle)
- Head SHA: `d2c18375`
- Scope digest: `e841a998be1c` (regenerable con scripts/factory_review_bundle.py)
- Reviewer verdict: {{JUDGMENT_VERDICT}}

## Contributor checklist
- [x] Linked issue is open and human-approved; approval was not self-granted.
- [x] Delivery mode matches the issue DoD and first-line keyword.
- [x] Exactly one supported `type:*` label is applied.
- [x] Modified shell scripts passed shellcheck (or N/A with reason) — N/A: no shell scripts modified.
- [x] Changed skills were tested in an agent (or N/A with reason) — N/A: no skills modified.
- [x] Documentation reflects changed behavior — §14.7 ya reservaba «Apertura» para el vaivén; el artefacto odd/tasks/1535-inspector-agarre.md registra hallazgos del host run.
- [ ] Commits follow Conventional Commits, without AI attribution trailers — los commits siguen Conventional Commits y llevan trailer `Co-Authored-By` por instrucción de la tarea; el squash los colapsa. Sin marcar para que el owner decida.

## Delivered scope
Aceptación de la issue (los 4 ítems):
1. Pruebas JS de los estados de la tarjeta — hereda, excepción, varios, bloqueado, sin conexión y desactualizado (11 casos del módulo + harness del inspector).
2. Cero tarjetas «Apertura del diseño» y ningún texto visible con código `OPENING_` — asertado por `granete_grip_js_test.rb` sobre el dialog y los mapas.
3. TestUp en host real — los 5 flujos de la aceptación a nivel bridge sobre SketchUp 2026 con el RBZ instalado (5 corridas / 0 fallos); el vivo con servidor vinculado queda para la verificación del owner con #1536.
4. Respuestas tardías indexadas por proyecto — doble llave (bridge rechaza proyecto ajeno; el módulo descarta proyecto/requestId vencidos) probada en unit y host.

## Remaining scope
None dentro del alcance de la issue. El ejemplo de oración con anchos y cantidades de BOM («perfil L: 0.56 m · 2 soportes») exige ampliar el reporte del servidor (suposición 2 del brief aprobado) y queda fileado para #1536.

## Merge boundary
Entrega completa: primera línea con keyword de cierre + `Delivery: complete`; al ser mergeada por el humano a `main`, GitHub cierra la issue nativamente. Los metadatos validados no autorizan el merge: el merge sigue siendo humano y exige readback exacto de CI/review en el HEAD final.
