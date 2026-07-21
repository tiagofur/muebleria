# Technical Design Decisions

> **Propósito**: Decisiones de implementación no obvias.  
> Producto / flujo: [`product-map.md`](product-map.md) · Arquitectura: [`architecture.md`](architecture.md)

---

## Índice

| # | Fecha | Título | Decisión |
|---|-------|--------|----------|
| TD-001 | 2026-07-20 | Orden de entrega vs PRD §6 | Horizonte B (taller sin 3D) antes del CAD 3D |
| TD-002 | 2026-07-20 | Shell de 3 módulos vs 4 modos | Sidebar = Ingeniería/Presupuestos/Producción; modos CAD = dentro de proyecto |
| TD-003 | 2026-07-20 | Stack web | Vite + React monorepo; no Next.js |
| TD-004 | 2026-07-20 | Dónde vive el cálculo | Solo `packages/domain` (+ nesting en `packages/excel`) |

---

## TD-001: Orden de entrega vs PRD §6

**Fecha**: 2026-07-20  
**Status**: aceptada

### Contexto

El PRD original proponía Core → 3D → Nesting UI → DXF. El valor inmediato del
taller es catálogo + cotización + despiece/export **sin** canvas espacial.

### Decisión

Usar horizontes en [`roadmap.md`](roadmap.md): A dominio → B app taller → C
espacial 2D → D 3D/CAM. Las fórmulas y el nesting core se adelantan al 3D.

### Consecuencias

- Un agente no debe abrir Babylon “porque el PRD dice Fase 2”.
- El PDF comercial (F020) cierra el loop de venta antes del room editor.

---

## TD-002: Shell de 3 módulos vs 4 modos

**Fecha**: 2026-07-20  
**Status**: aceptada

### Contexto

`docs/ideas.md` y el PRD describen 4 modos CAD; la UI construida expone 3
módulos de negocio. Mezclarlos genera features en el lugar equivocado.

### Decisión

- **Sidebar** = módulos de app (Eje A).  
- **Stepper 4 modos** = solo dentro de un proyecto de diseño (Eje B, futuro).  
- Documentado en [`product-map.md`](product-map.md) y PRD §0.

### Consecuencias

- “Habitación” no es item hermano de “Clientes”.  
- Producción (módulo) y Modo 4 comparten motor de dominio.

---

## TD-003: Stack web = Vite + React

**Fecha**: 2026-07-20  
**Status**: aceptada

### Contexto

Bocetos con Next.js App Router en ideas antiguas.

### Decisión

Mantener **pnpm workspaces + Vite + React** en `apps/web`. No migrar a Next
salvo decisión explícita nueva en este archivo.

### Consecuencias

- No crear `app/` router ni server components para el shell del taller.  
- SSR no es requisito del producto actual.

---

## TD-004: Cálculo solo en domain/excel

**Fecha**: 2026-07-20  
**Status**: aceptada

### Contexto

Riesgo de reimplementar fórmulas en componentes React.

### Decisión

- Despiece, BOM, kitchen, pricing → `@muebles/domain`.  
- Nesting y CSV optimizer → `@muebles/excel`.  
- React solo invoca y renderiza.

### Consecuencias

- Golden tests en domain son la fuente de verdad milimétrica.  
- UI puede reemplazarse sin reescribir ingeniería.

---

## Formato de entrada nueva

```markdown
## TD-00N: [Título corto]

**Fecha**: YYYY-MM-DD  
**Autor**: [agente/nombre]  
**Status**: [propuesta / aceptada / reemplazada]

### Contexto
### Decisión
### Consecuencias
### Referencias
```
