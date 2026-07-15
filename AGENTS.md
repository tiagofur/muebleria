# AGENTS.md — Mapa de navegación

> Este archivo es el **punto de entrada** para cualquier agente que trabaje
> en este repositorio. Es un **mapa**, no un manual. Lee solo lo que necesites
> cuando lo necesites.

---

## 1. Antes de empezar (siempre)

```bash
./init.sh
```

Si falla → **para**. Resuelve el entorno antes de tocar código.

Luego:
1. Lee `progress/current.md` — ¿hay una sesión activa?
2. Lee `feature_list.json` — toma la tarea `pending` de menor id.

---

## 2. Mapa del repositorio

| Recurso | Qué contiene | Cuándo leerlo |
|---------|-------------|---------------|
| `feature_list.json` | Tareas con estado (pending / in_progress / done / blocked) | Al empezar |
| `progress/current.md` | Estado de la sesión activa | Al empezar |
| `progress/history.md` | Bitácora de sesiones anteriores | Si necesitas contexto histórico |
| `docs/prd.md` | Qué es el producto y por qué (requisitos, dominio, fórmulas) | Antes de implementar algo de dominio |
| `docs/architecture.md` | Cómo se estructura el código (paquetes, boundaries) | Antes de crear archivos |
| `docs/conventions.md` | Estilo, nombres, tests, errores | Antes de escribir código |
| `docs/design.md` | **Sistema de diseño UI/UX**: tokens CSS, tipografía, colores HSL, iconos (Lucide), patrones de interacción (modal, sidebar, toast, lista→detalle), componentes y reglas de implementación | **OBLIGATORIO** antes de crear o modificar cualquier componente, pantalla, CSS o layout |
| `docs/verification.md` | Cómo demostrar que funciona | Antes de declarar `done` |
| `CHECKPOINTS.md` | Criterios del revisor | Para auto-evaluarte |
| `.agents/skills/` | Cómo actuar según tu rol (leader / implementer / reviewer) | Lee tu rol |
| `Plantilla_Muebles.xlsx` | Fuente de dominio: fórmulas, datos de referencia | Para el golden test |
| `Plantilla_Optimizer.xlsx` | Contrato de salida del export | Para tests de fixture |

---

## 3. Reglas duras

- **Una sola feature a la vez.** `init.sh` rechaza más de un `in_progress`.
- **No `done` sin tests verdes.** Ejecuta `./init.sh` o `pnpm test` antes de cerrar.
- **Documenta en `progress/current.md`** mientras trabajas, no al final.
- **Si no sabes algo**, busca en `docs/` antes de inventarlo.
- **Deja el repo limpio** al cerrar (ver `docs/verification.md §Verificación final`).
- **Antes de tocar UI/UX** (componentes `.tsx`, archivos `.css`, layouts, estilos inline), lee `docs/design.md` completo. No inventes colores, espaciados, sombras ni patrones de interacción — todos están definidos ahí.

---

## 4. Tu rol en esta sesión

Lee el skill de tu rol antes de hacer cualquier otra cosa:

| Rol | Archivo | Cuándo |
|-----|---------|--------|
| Orquestador / líder | `.agents/skills/leader/SKILL.md` | Eres el agente principal coordinando trabajo |
| Implementador | `.agents/skills/implementer/SKILL.md` | Te pidieron implementar una feature concreta |
| Revisor | `.agents/skills/reviewer/SKILL.md` | Te pidieron revisar trabajo del implementador |

Si no te indicaron un rol, actúa como **implementador**.
