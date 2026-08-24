# Sesión

**Features cerradas:** F154 — table_expand_chevron_affordance
**Inicio:** 2026-08-24 · **Cierre:** 2026-08-24
**Reviews:** `progress/review_F154.md` (APPROVED)
**Rama:** `feat/f154-row-expand-affordance` (pusheada)

## Resultado

Hallazgo P1 #1 de la auditoría de paridad UI resuelto: las tablas expandibles
de catálogo ahora anuncian que la fila abre. `CatalogTable` (componente
compartido por Materiales, Cantos, Herrajes, Acabados, Grupos y Clientes)
antepone una columna estrecha con chevron por fila expandible:

- reposo apunta a la derecha; rota 90° al expandir (`--transition-transform`
  bajo `prefers-reduced-motion: no-preference`, flip directo con reduced);
- color muted → secondary en hover/focus-within/fila expandida;
- chevron `aria-hidden` (la fila es el control, que ya expone
  `aria-expanded`) y cabecera con label accesible «Detalle»;
- gating correcto: sin `renderExpandedDetail` no hay chevron (no promete
  expansión inexistente).

Implementa exactamente lo que design.md §4.2 (F150) sanciona: "la fila abre;
su affordance es el chevron".

## Verificación (evidencia)

- `pnpm test` 3.048 verdes (ui 1.401 con 7 tests nuevos de comportamiento);
  `pnpm typecheck` 0 errores.
- Visual en navegador (guest, seed demo): Materiales reposo/expandido con
  zoom (chevron rota 90°, panel intacto), Clientes hereda, 390px sin overflow
  (scroll-x + fade existentes).

## Notas

- Los tests de pantalla existentes no asumen índices de celda — sin ajustes.

## Siguientes pasos (backlog auditoría)

1. Estructuras: Desactivar/Eliminar al overflow "Más" (hallazgo P2 #4).
2. Continuar revisión: Estructuras, Componentes, catálogos, Clientes, Vitrina.
3. Headings múltiples en Librería (P2 #3) y "Sin foto" en nombre accesible
   (P3 #5) por pantalla.
