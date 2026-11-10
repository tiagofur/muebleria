# #1536 — [SketchUp] Representación en el modelo: perfil L/C, tira italiana, bisel y rebase

Lane: Delegated Direct (motor acotado + plugin Ruby/JS + TC de host). Writer: esta sesión (worktree `1536-representacion-agarre`, rama `feat/1536-representacion-agarre`, base origin/main 8b621c85).
Sin prerrequisito de brief (sin ux:shape); prerrequisitos #1529 y #1532 mergeados.

## Alcance ejecutado
1. **Tira italiana ENTRE cajones como tableros reales** (motor): `ProjectGripBetweenStrips` proyecta los miembros componente del perfil ENTRE congelado y el layout emite una tira por arista de la pila resuelta — la regla de la tira superior espejada (el borde superior de la tira cuelga del borde inferior del frente superior), todo el ancho, rol FRENTE, fail-closed ante componente ausente/inactivo. Marcador server-declared `openingStrip` en los tableros de tira: tablero del corte, NUNCA un frente de la pila A3 (sin inferencia por nombre).
2. **El perfil C entre frentes materializa su corrida de hardware**: `ProjectGripBetweenHardware` proyecta el hardware del perfil ENTRE congelado (id + envolvente de ficha) y el layout emite una placement derivada por arista — fail-soft en el modelo (el BOM de la cotización igualmente lo exige).
3. **Plugin**: el rebuild de UN mueble manda `furnitureInstanceId` en el resolve (la excepción de agarre de ESE mueble gobierna — antes usaba el agarre del primer mueble del diseño); el placeholder del canal se aparta ante tiras materializadas (ids server-declared `opening-strip-*`); `LocalGeometry` corta MÚLTIPLES muescas por lateral (una por arista entre cajones — el límite v1 de una por tablero reventaba con la columna de 3 frentes, hallazgo del host run); filas de muescas sin solape, fail-closed.
4. **Contrato**: los escenarios de agarre entran al golden compartido (40 L+C, 41 italiana, 42 alacena rebase 20) generados desde el resolver Go; el schema nombra los campos que el wire lleva (designId/furnitureInstanceId del pin por mueble, notches/bevels de #1356/#1327, catalogComponentId/optionRole/assemblyInstanceId, routingCuts/bevel del mecanizado y la provenance openingProfile); el validador TS acepta los campos del pin. El test TS de paridad de mecanizado se escopa a los escenarios con relationships (los de agarre son resolución del SERVIDOR — TS nunca recalcula geometría de apertura).
5. RBZ 0.1.109.

## Evidencia
- Backend: engine/api/domain/storage ok; tests nuevos — tira ENTRE como tableros (una por arista, dims declaradas, rol FRENTE), fail-closed, frente único sin tiras, corridas del C entre frentes con la regla espejada (API punta a punta), componente ausente rechaza.
- TS: contract/schema/resolve tests verdes (2182 en el paquete domain completo).
- Ruby: rake unit 1495/0; rubocop 0 ofensas; rake verify verde (RBZ 0.1.109 firmado).
- **Host real (SketchUp 2026, RBZ 0.1.109 instalado)**: TC_OpeningRepresentationSmoke **5 corridas / 19 aserciones / 0 fallos** — cajonera L+C con las 2 corridas del C entre frentes, italiana con las 2 tiras ENTRE colgando del borde inferior del frente superior (regla espejada), alacena con el frente extendido 20 mm por debajo del piso, doble reconstrucción sin duplicados (ids de identidad + conteos + definiciones estables), fallo preserva la geometría. Nota: `Sketchup.file_new` cambia de modelo en forma diferida — el TC limpia los restos en el MISMO modelo en vez de confiar en el switch.
- Hallazgo del host run corregido: `LocalGeometry` v1 reventaba con múltiples muescas por lateral.

## Ledger parcial del juicio dual (Judge A; Judge B en curso)
Judge A sobre 19cd7981: 5 MAJOR + 3 MINOR.
- MAJOR: aristas ENTRE contadas por PAR DE TABLEROS en vez de por FILA A3 — frentes lado a lado (una fila, cero aristas) fabrican tira y corrida del C fantasma (probe: 2 puertas → tira z=-68 bajo el piso).
- MAJOR: las tiras ENTRE nunca llegan al despiece ni al release (resolve.go sólo enhebra ComponentMembers; production_releases arma Members sin la proyección between) — drift modelo↔despiece contra §14.6.
- MAJOR: la multi-muesca computa UNA sola sección reducida (bands.first) y la aplica a todas las bandas — profundidades distintas entre perfiles se materializan con la profundidad de la primera, sin fail-closed (el código previo fallaba ruidoso; el nuevo es silencioso).
- MAJOR: el TC de fallo es tautológico (no intenta rebuild fallido entre snapshot y aserción) y las medidas del modelo jamás se comparan contra la resolución en host.
- MINOR: C-runs alojadas en el frente superior (el host binding del drawer las mueve con la apertura — invariant #1300: el host truthful es el tablero de carcasa); fixture sin techo suelta members between cuando el top no declara partes; guard del placeholder muerto (board.id no existe — el accesor es component_instance_id); multi-muesca usa bands.first para TODAS las bandas; FURNITURE_KEYS sin validación de tipo/largo; comentario doc desplazado.

## Ronda 1 de corrección (owner: ronda completa)
Aplicado sobre el ledger del juicio (Judge A 5 MAJOR + 3 MINOR; Judge B confirmó ×2 los mismos):
- **Filas A3, no pares de tableros** (×2 MAJOR): las tiras y las corridas del C se emiten por los límites de FILA de la pila resuelta (openingFrontRows / componentFrontRows) — dos puertas lado a lado (una fila, cero aristas) ya no fabrican geometría fantasma; sin duplicados cuando una fila tiene dos frentes. C-run z = rows[k−1].bottom − alto (corregido de por-pair a por-fila; el fixture queda idéntico en filas de un solo frente).
- **Carcasa #1300** (Judge B MAJOR): las corridas del C se alojan en el tablero de carcasa (el techo), nunca en el frente — el golden 40 regenerado lo pinza y el TC lo aserta.
- **Tiras al despiece y release** (×2): resolve.go enhebra las tiras ENTRE (una por arista del stack report) y production_releases arma los members con las proyecciones between — ONE projection restaurado (autoría = despiece = release).
- **v2 height_mm** (Judge B MAJOR): las proyecciones top+between leen el contrato v2 de la tira (height_mm + banda del perfil = depth) — los perfiles del editor #1534 proyectan sus tiras; sin banda declarada: ausencia honesta.
- **Between members sin partes top** (×2 MINOR): el handler arma members aunque el top no declare partes.
- **Multi-muesca por banda** (A MAJOR/B MINOR): reduced_cross_section POR banda con validación de borde por banda — §13.3 sin silencio.
- **Channel guard** (MINOR): component_instance_id (el :id viejo era código muerto).
- **TS validator** (Judge B MAJOR): los escenarios del golden pasan el validador runtime (component keys + provenance openingProfile + routing/bevel) y FURNITURE_KEYS valida tipo/largo de los pins; doc comment restaurado.
- **TC honesto** (×2 MAJOR): fallo de resolve REAL vía el coordinator (nunca commitea, geometría intacta), medidas del modelo vs resolución (min.z + extent Z de cada tablero contra el wire — bounds.depth es el eje Z), host carcasa asertado, sin duplicados; 5 corridas / 61 aserciones / 0 fallos en SketchUp 2026 con RBZ 0.1.111.
- **Regression tests** de los probes de los jueces: puertas lado a lado → cero tiras; v2 height-only → depth de la banda.

## Pendiente (vivo owner)
- La verificación visual del propietario sobre los tres modelos (las medidas ya quedaron asertadas contra la resolución del servidor por el TC de host).

## Judgment-day dual
Jueces A/B lanzados sobre el delta 8b621c85..19cd7981 con CI success (run 42856732513) y bundle scope_sha256=25494f6d07db. Ledger al cierre en el PR.

## Entrega
Un PR contra main. Los 3 ítems de alcance + aceptación (TestUp en host real con los 3 modelos, doble reconstrucción sin duplicados, fallo preserva geometría) cubiertos.
