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

## Pendiente (vivo owner)
- La verificación visual del propietario sobre los tres modelos (las medidas ya quedaron asertadas contra la resolución del servidor por el TC de host).

## Judgment-day dual
Jueces A/B lanzados sobre el delta 8b621c85..19cd7981 con CI success (run 42856732513) y bundle scope_sha256=25494f6d07db. Ledger al cierre en el PR.

## Entrega
Un PR contra main. Los 3 ítems de alcance + aceptación (TestUp en host real con los 3 modelos, doble reconstrucción sin duplicados, fallo preserva geometría) cubiertos.
