# ODD — #1132 Body modifiers por rol constructivo: reducción de techo y saques como features de maquinado

- **Issue**: tiagofur/muebleria#1132 (`status:approved`, épica OPEN-FRONT).
- **Lane**: Inline Direct (resolver puro + contrato, bounded, un escritor)
  con artefacto para recuperación — #1133 (BOM), el wiring vivo y el Inspector
  consumen lo decidido aquí.
- **Base**: `origin/main` @ `d537444b` (post merge del PR de #1131). Rama:
  `feat/1132-body-modifiers`, worktree `../muebles-worktrees/1132-body-modifiers`.
- **Estado**: IMPLEMENTED_PENDING_REVIEW.

## Resultado observable

`resolveOpeningBodyModifiers` (TS) / `ResolveOpeningBodyModifiers` (Go)
consume la resolución de layout de apertura (#1131) + los modifiers declarados
por los perfiles (#1130) y produce efectos EXACTOS por rol constructivo: la
reducción de profundidad del panel horizontal de la frontera (valor exacto
declarado, aplicado UNA vez) y los saques laterales con posición resuelta
(offset a lo largo del eje del frente, mismo sistema de coordenadas que los
fronts). Cada efecto es una feature de maquinado con identidad estable
(effect|role|boundary), proveniencia (perfil+frontera) y geometría completa.

## Decisiones de diseño

- **D1 Vocabulario real, no conceptual**: el doc habla de roles «top»/«side»;
  el vocabulario ConstructiveRole real (#1052) es
  `horizontal|lateral|shelf|back|door|divider|custom`. El modifier declara el
  rol real; un rol fuera del vocabulario falla cerrado
  (`OPENING_BODY_MODIFIER_INVALID`) — el caso «techo» del fixture prueba que
  NO hay string matching de nombres. La desambiguación top/bottom del panel
  horizontal la da la FRONTERA del perfil (top⇒panel superior,
  bottom⇒inferior), no el nombre.
- **D2 Posición como dato resuelto**: el perfil declara la CLASE de posición
  (`NotchAt`: top_front | bottom_front | front_boundary); el resolver la
  combina con la frontera para el offset exacto: top_front⇒0, bottom_front⇒
  fin de la región disponible, front_boundary⇒fin de la zona debajo de la
  frontera (del grip con side 'below'). Clase incompatible con la frontera ⇒
  fail-closed.
- **D3 Double-apply guard estructural**: un perfil por frontera (un grip);
  identidad effect|role|boundary con dedupe de valores idénticos y
  `OPENING_BODY_MODIFIER_CONFLICT` ante valores distintos. L en top + C
  intermedia nunca duplican: la C declara sólo saque en su frontera (caso B
  del fixture: reducción 20 una vez + saque top_front offset 0 + saque C
  offset 305).
- **D4 Forma de contrato camelCase**: la entidad #1130 persiste snake_case
  (`depth_reduction_mm`); el contrato TS↔Go usa camelCase
  (`OpeningContractBodyModifier`) con conversor desde la entidad
  (`openingContractBodyModifier`), un solo vocabulario sin tercera forma.
- **D5 Machining identity**: la forma canónica del modifier resuelto cubre
  geometría completa + proveniencia — cualquier cambio de valor mueve la
  identidad de fabricación (test). Los saques quedan listos para el pipeline
  con la misma disciplina de fingerprint del maquinado existente.

## Fuera de alcance (explícito, nombrado)

- **Wiring vivo en `deriveAuthoringMachining` / `ResolveAuthoringLayout`**:
  ningún diseño porta aún la intención de apertura (portador llega con
  overlay de capacidades + Web settings + migración jaladera + Inspector).
  Los boards no reciben aún la reducción ni las operaciones; el parameter
  sería muerto hoy.
- **Adaptadores de export**: DXF/KDT/BHX son hoy drilling-only; el saque
  (contorno 2D) requiere soporte de feature en cada receptor — slice propio
  cuando exista un diseño real que lo produce.
- BOM de perfiles (#1133), validación de selección, bottom_overhang (OQ-3).

## Verificación

- `go build/vet/test ./internal/...` desde `backend-go`: VERDE (contrato
  compartido + identidad de maquinado + units de vocabulario/baseline/perfil
  desconocido).
- `pnpm typecheck` workspace: limpio. `pnpm test` raíz: VERDE (15 tests
  nuevos: 5 resolución + 1 bloqueado + 6 inválidos + schema + 2 units).
- Sin cambios storage/SQL/API: no aplica `scripts/backend-test.sh`.

## Siguiente slice

#1133 BOM de perfiles (longitud, soportes, tapas) consume los boundaries del
layout + BOMMembers del perfil; el wiring vivo del body modifier entra
cuando exista el portador de la intención.
