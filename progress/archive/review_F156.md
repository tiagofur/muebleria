# Review — feature F156

**Veredicto:** APPROVED

**Rama:** `feat/f154-row-expand-affordance` (commit de F156; PR #359 junto a
F154/F155 por decisión del dueño — commits y reviews separados)

## Alcance revisado

- `packages/ui/src/common/CatalogImage.tsx` — placeholder decorativo.
- `packages/ui/src/common/CatalogImage.test.tsx` — 3 tests (nuevo archivo).
- `feature_list.json` / `progress/current.md` — ledger + evidencia de la
  verificación colateral de P2 #3.

## Checkpoints

- C1: [x] `pnpm test` exit 0 (3.055); typecheck 0.
- C2: [x] Feature registrada; current.md con evidencia.
- C3: [x] Presentación pura; sin dependencias nuevas.
- C4: [x] Tests de comportamiento + verificación de nombre accesible real en
  navegador (post-reload), no sólo DOM grep.
- C5: [x] Push en el cierre.

## Diseño UI/UX (docs/design.md §8)

- D1: [x] N/A — sin CSS nuevo.
- D2: [x] Patrón lista→detalle intacto; el placeholder no es contenido.
- D5: [x] Iconos Lucide existentes; los aria-hidden de los iconos internos
  se volvieron redundantes y se quitaron junto con el role (todo el
  placeholder es aria-hidden).
- D7: [x] A11y: el estado "sin foto" es metadato visual no esencial; el
  nombre de la entidad ya vive en el heading de la card (§4.8 "el
  significado nunca viaja solo por color/imagen"). La imagen real conserva
  alt (contenido). Sin motion/copy nuevos; responsive N/A.
- D8: [x] Verificación: nombre accesible de la card sin "Sin foto" y sin
  duplicación del nombre; placeholder sin role=img (snapshot ARIA
  post-reload).

## Notas de revisión

1. La auditoría citaba "Sin foto | MOD-GAB-01 | Gabinete…" — la causa era el
   `role="img"` + `aria-label={alt}` del placeholder, que además duplicaba el
   nombre (el announcement lo leía dos veces). Ambos ruidos eliminados.
2. `queryByText` no sirve para probar exclusión del árbol accesible
   (aria-hidden no saca el nodo del DOM) — el test afirma el contrato real
   (atributos del contenedor), y la exclusión se verificó en el snapshot
   ARIA del navegador.
3. P2 #3 (headings) verificado resuelto en main: 1 h2 por pantalla de
   Librería, cards h3 — registrado en current.md como evidencia, sin código
   redundante.

## Cambios requeridos

Ninguno.
