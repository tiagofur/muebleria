# ODD — #1133 BOM de perfiles: longitud, soportes y tapas desde el resultado resuelto

- **Issue**: tiagofur/muebleria#1133 (`status:approved`, épica OPEN-FRONT).
- **Lane**: Inline Direct (resolver puro + contrato, bounded, un escritor)
  con artefacto para recuperación — el wiring comercial y el Inspector
  consumen lo decidido aquí.
- **Base**: `origin/main` @ `9e444b97` (post merge del PR de #1132). Rama:
  `feat/1133-opening-bom`, worktree `../muebles-worktrees/1133-opening-bom`.
- **Estado**: IMPLEMENTED_PENDING_REVIEW.

## Resultado observable

`resolveOpeningBOM` (TS) / `ResolveOpeningBOM` (Go) genera las líneas de BOM
de perfiles y accesorios desde la resolución de layout (#1131) y las reglas
DECLARADAS en los bom_members de cada perfil (#1130): corrida con longitud
exacta, soportes por ficha, tapas por condición de extremo resuelta. BOM
consume geometría resuelta y reglas del perfil; NO es un segundo motor
geométrico.

## Decisiones de diseño

- **D1 Longitud exclusivamente por regla declarada**: `interior_width` es la
  única regla de corrida v1; la longitud = interior del gabinete, INPUT del
  contexto del cuerpo (el ancho interior no se deriva aquí — eso sería el
  segundo motor geométrico prohibido). Regla desconocida o regla/member
  inconsistentes fallan cerrado.
- **D2 Unidad de presentación definida**: la corrida se presenta en `meter`
  (cantidad = mm/1000 exacto) con `CutLengthMm` al lado; sin unidad declarada
  en el miembro ⇒ fail-closed (la presentación indefinida no viaja). Soportes
  y tapas se presentan en `piece` (unidad estructural del conteo; si el
  miembro declara otra, falla).
- **D3 Soportes con la convención de estaciones del sistema**: cantidad =
  ceil(longitud/spacing)+1 — la MISMA convención del resolver de joinery
  (#1219). El spacing SIEMPRE viene de la ficha (`per_length` sin spacing ⇒
  fail-closed: no se inventa separación).
- **D4 Tapas por condición de extremo RESUELTA**: el llamador declara
  left/right ∈ exposed|closed (hecho de diseño del módulo; la agregación de
  corridas multi-módulo es scope posterior explícito del doc §4); una tapa
  por extremo expuesto. La variante de SKU (abierta/cerrada de Cymisa) es
  dato del perfil, no lógica del resolver.
- **D5 Determinismo e idempotencia estructurales**: identidad de línea =
  `boundary|memberKey`; miembros en orden canónico profile→supports→endCaps
  sobre el orden del ledger de fronteras; re-resolver produce EXACTAMENTE la
  misma lista (probado en test) — la fusión comercial aditiva por hardwareId
  es del consumidor (#986 patrón), no del resolver. Dos fronteras con el
  mismo perfil = dos corridas físicas = líneas separadas.
- **D6 Proveniencia completa**: cada línea lleva profileId + version (la
  revisión pineada; version ≤ 0 falla cerrado — una referencia sin revisión
  no existe) + frontera + regla aplicada.
- **D7 Forma de contrato camelCase** (misma decisión que #1132): conversor
  `openingContractBOMMember` desde la entidad persistida; claves de miembro
  válidas profile|supports|endCaps — una clave desconocida falla cerrado
  (descartar hardware declarado sub-cotizaría el BOM).

## Fuera de alcance (explícito, nombrado)

- **Entrada al BOM comercial vivo**: sin portador de la intención de apertura
  en los diseños (llega con overlay de capacidades + Web settings), el
  resolve del proyecto no consume estas líneas todavía; la fusión aditiva
  con demanda existente es del wiring posterior.
- Agregación de corridas multi-módulo (esquinas 90°, runs continuos) y
  precios (los códigos/precios se unen del catálogo al consumir, patrón
  #917).

## Verificación

- `go build/vet/test ./internal/...`: VERDE (contrato compartido con
  idempotencia probada + units de mapeo entidad→contrato y presentación
  métrica exacta).
- `pnpm typecheck` workspace: limpio. `pnpm test` raíz: VERDE (15 tests
  nuevos: 5 resolución + 7 inválidos + schema + 2 units).
- Sin cambios storage/SQL/API: no aplica `scripts/backend-test.sh`.

## Siguiente slice

#1134 overlay de capacidades `opening.*` + Web settings — la primera
superficie de authoring: desde ahí los diseños empiezan a portar la
intención de apertura y el wiring vivo (body modifiers + BOM al resolve
comercial) se vuelve alcanzable.
