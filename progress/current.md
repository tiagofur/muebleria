# Sesión

**Feature cerrada:** F142 — proyectar_materials_dock (#309 P3D-0b, meta #308 etapa E2)
**Inicio:** 2026-08-22 · **Cierre:** 2026-08-22
**Subplan (SDD):** https://github.com/tiagofur/muebleria/issues/309#issuecomment-5381687420

## Resultado

Dock de materiales con sub-tabs **Ambiente | Tableros** separados por naturaleza
(ambient = presentación; tableros = MaterialBoard cotizable con fabricante
obligatorio + subgrupos). Aplicación con scopes (frentes/interior/mueble/obra),
drag con highlight y rechazo que enseña sobre superficies ambientales
(anti-leak por tipo). Resolver puro nearest-hit + mesada bloqueada.
Backend: manufacturer + material_categories con RBAC (espejo F086).

## Verificación (evidencia)

- `pnpm test` 2.830 OK (domain 945 · storage 154 · excel 89 · ui 1.279 ·
  mobile 45 · desktop 17 · web 301)
- `pnpm typecheck` 0 errores · `go build && go vet && go test ./...` OK (8 pkgs)
- Smoke WebGL Playwright 1 passed (sub-tab Tableros + screenshot
  `test-results/proyectar-boards-dock.png` revisado)
- Review: 2 pasadas (CHANGES_REQUESTED con R1+3×R2 → fixes → **APPROVED**);
  residuos R3 saldados (boardPaintDrag write-only eliminado, onDragEnter).

## Siguiente etapa

E3 / F143 — Selección multi/jerárquica + clipboard/align (#310, meta #308).
