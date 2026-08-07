# Proyectar / 3D — smoke checklist

**Alcance:** solo diseño espacial y preview 3D (Proyectar + dominio kitchen/plinth + soft lock).  
**No incluye:** módulo Producción, exports fábrica, OP hub.

**Última corrida:** 2026-08-07  
**Rama:** `main` @ post-#252 (QA #251 multi-space / free-only)  
**Modo:** automatizado (CI-local) + ítems que requieren ojo humano en browser

---

## 0. Cómo re-correr el automatizado

```bash
pnpm --filter @muebles/domain test -- kitchenLayout planImport plinth planEditSession spatial
pnpm --filter @muebles/ui test -- ProjectSpatialStudio project3dPreview sceneLighting rotationMapping
pnpm --filter @muebles/ui typecheck
pnpm --filter web typecheck
```

---

## 1. Criterios del programa SUPER 3D (`projectar-super-3d-plan.md` §6)

| # | Criterio | Cómo se verifica | Resultado |
|---|----------|------------------|-----------|
| 1 | Canvas ≥ ~70 % alto en desktop Proyectar | CSS `module-scene-3d--fill` + test hero; **ojo humano** en 1080p | 🟡 AUTO OK · 👁 pendiente browser |
| 2 | Sin banda negra vacía bajo el canvas | `fillViewport` en studio; CSS override 380px solo fuera de fill | 🟡 AUTO OK · 👁 pendiente browser |
| 3 | Cocina L + 6 muebles + zoclo &lt; 10 min | Flujo create L + place + base clearance en tests; **tiempo real** | 🟡 flujo existe · 👁 tiempo real |
| 4 | Drag muro + presets + acabados en Proyectar | Tests place/preset; drag wall en domain snap | 🟡 AUTO parcial · 👁 drag WebGL |
| 5 | Cotización sin plano = fallback lineal | `project3dLayout` / `project3dPreview` tests | ✅ PASS |
| 6 | Sin regresión kitchenLayout / studio | suites domain + `ProjectSpatialStudio` | ✅ PASS |

---

## 2. Partes SUPER 3D (0–5)

| Parte | Checks automatizados | Resultado |
|-------|----------------------|-----------|
| **0 Viewport hero** | `uses fillViewport studio layout class for hero 3D`; CSS `--fill` | ✅ |
| **1 Tooling** | `shows scene toolbar and can toggle plan mini`; lighting selector | ✅ |
| **2 Lista** | filtros, collapse rail, double-click place, create L | ✅ |
| **3 Manipulación** | repack + undo; domain snap/repack | ✅ |
| **4 Realismo** | countertop toggle, wall Z 1500, base clearance (zoclo) | ✅ |
| **5 Puente** | bootstrap unplaced after add-item; quote total; freeze badge | ✅ |

---

## 3. Icebox v1

| Ítem | Tests / evidencia | Resultado |
|------|-------------------|-----------|
| Islas / free place | domain free placement + studio island place + free inspector | ✅ |
| Multi-ambiente | domain spaces + studio `adds a second environment` | ✅ |
| Import DXF + underlay | `planImport` + studio `imports DXF walls` + PDF guidance | ✅ |
| Zoclo BOM | `plinth` + `plinthBom` | ✅ |
| Empaque barras | (domain/excel packageSize — fuera de UI studio) | ✅ (prev. merge) |
| Luces PBR liviano | `sceneLighting` + studio lighting selector | ✅ |
| Soft lock multi-user | `planEditSession` + studio locked/acquire banners | ✅ |

---

## 4. Suites corridas (esta sesión)

| Suite | Resultado |
|-------|-----------|
| `@muebles/domain` (full filter run → 331 tests) | ✅ 331/331 |
| `@muebles/ui` (full package → 487 tests) | ✅ 487/487 |
| `@muebles/ui` typecheck | ✅ |
| `web` typecheck | ✅ |

Notas:

- Vitest de UI carga más archivos que el filtro de nombre (suite package completa verde).
- Warning conocido: `THREE.WARNING: Multiple instances of Three.js` en jsdom — no falla tests.

---

## 5. Checklist manual (browser) — solo 3D

Correr con: app web + backend si usás auth; proyecto **draft**.

### 5.1 Estudio Proyectar

- [ ] Abrir cotización draft → **Proyectar**
- [ ] Canvas llena el centro (sin franja negra grande bajo el 3D)
- [ ] Toolbar: vista iso/frente/planta, contornos, planta 2D mini, lighting
- [ ] Crear **L**, colocar 3–6 unidades (doble click / colocar)
- [ ] Drag a lo largo del muro; undo/redo
- [ ] Isla (free place) + rotación en inspector
- [ ] Segundo **Ambiente**, colocar algo, volver a Cocina (contenido no se pisa)
- [ ] **Regresión #251:** +Ambiente vacío → cerrar/reabrir proyecto → Cocina **sigue** con muros/muebles
- [ ] Solo islas (sin muros): free place se ve en 3D (no corrida lineal)
- [ ] Import **DXF** de prueba (muros); import imagen underlay + escala
- [ ] Zoclo: clearance / mesada / altura alacena
- [ ] Preset de medida + acabado en inspector sin salir de Proyectar
- [ ] Cerrar y reabrir: layout persistido

### 5.2 Soft lock (auth, 2 usuarios)

- [ ] Usuario A abre Proyectar → puede editar
- [ ] Usuario B abre el mismo proyecto → banner “está editando” + solo lectura
- [ ] A cierra → tras TTL o release, B puede adquirir

### 5.3 Cotización 3D (sin / con plano)

- [ ] Proyecto **sin** `kitchenLayout` → Vista 3D / Presentar: corrida lineal OK
- [ ] Con plano + unplaced → aviso / cola sin perder unidades
- [ ] Status no-draft → “Plano congelado”, no muta layout
- [ ] **Regresión #251:** proyecto accepted/quoted, cambiar tab de ambiente en Proyectar → **no** pisa layout en servidor

### 5.4 Producción (post-#214 / #251) — browser

Proyecto **accepted** con **2 ambientes** y muebles en ambos.

- [ ] `/produccion` → hub de la obra
- [ ] Tab Vistas / elevaciones: aparecen muros de **ambos** ambientes (nombres con prefijo)
- [ ] Filtro ambiente: despiece y herrajes bajan a ítems de ese espacio (no qty completa por moduleCode)
- [ ] Módulos: `pieceCount` no se duplica si el mismo código está en dos líneas
- [ ] Mover una isla en draft → export → accepted: stale OP / fingerprint reacciona
- [ ] Pack ZIP abre elevaciones coherentes

### 5.5 Preview 3D ingeniería (módulo / componente)

- [ ] Módulo: showcase / Vista 3D abre y no crashea
- [ ] Componente: geometry preview con rotación lateral correcta (JD-W3)
- [ ] Estructura: Vista 3D del detalle

---

## 6. Veredicto de esta corrida

| Capa | Estado |
|------|--------|
| Automatizado (domain + UI + typecheck) | **PASS** — 2026-08-07 (#251 fixes en #252) |
| Multi-space wipe / elev / fingerprint / scope | **Cubierto por tests** (domain + store + module rows) |
| Ojo humano browser (WebGL, soft lock 2 users, §5.1–5.4) | **Pendiente de sesión visual** |

**Conclusión:** bugs de campo multi-ambiente/OP encontrados en auditoría ya mergeados (#252). Residual: solo UX WebGL / dogfood de taller en browser.

Cuando completes §5, marcá checkboxes aquí o anotá bugs en issues con label `frontend` + mención “Proyectar smoke”.
