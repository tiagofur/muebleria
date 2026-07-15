# CHECKPOINTS — Evaluación del estado final

> En sistemas multi-agente no se evalúa el camino, se evalúa el destino.
> El revisor recorre esta lista antes de aprobar cualquier feature.

## C1 — El harness está completo

- [ ] Existen los archivos base: `AGENTS.md`, `init.sh`, `feature_list.json`,
      `progress/current.md`, `CHECKPOINTS.md`.
- [ ] Existen los 4 docs: `docs/prd.md`, `docs/architecture.md`,
      `docs/conventions.md`, `docs/verification.md`.
- [ ] Existen los 3 skills: `.agents/skills/leader/SKILL.md`,
      `.agents/skills/implementer/SKILL.md`, `.agents/skills/reviewer/SKILL.md`.
- [ ] `./init.sh` termina con exit code 0.

## C2 — El estado es coherente

- [ ] Como mucho una feature en `in_progress` en `feature_list.json`.
- [ ] Toda feature `done` tiene tests asociados que pasan en `pnpm test`.
- [ ] `progress/current.md` describe la sesión activa o está vacío
      (no contiene basura de sesiones anteriores).

## C3 — El código respeta la arquitectura

- [ ] `packages/domain` no importa react, electron, fs, ni librerías de xlsx.
- [ ] `packages/ui` no implementa fórmulas de costo ni accede a fs.
- [ ] `packages/excel` no importa react ni electron.
- [ ] Errores del dominio son instancias de `DomainError` (o subclases),
      no strings crudos ni `any`.
- [ ] No hay `console.log` de debug sueltos; usa el logger de dominio si hace falta.

## C4 — La verificación es real

- [ ] `pnpm --filter @muebles/domain test` pasa al 100%.
- [ ] Si la feature toca el export: test de fixture contra `ProductionCutRow[]`
      esperado.
- [ ] Si la feature toca storage: test con directorio temporal real (no mock de fs).
- [ ] Golden test del motor de dominio (F003/F011): totales coinciden con
      la plantilla dentro de tolerancia 0.01.

## C5 — La sesión se cerró bien

- [ ] No hay archivos sin trackear sospechosos (`*.tmp`, `dist/` dentro de
      paquetes sin `.gitignore`).
- [ ] `progress/history.md` tiene una entrada por la última sesión.
- [ ] La feature trabajada refleja su estado correcto en `feature_list.json`.
- [ ] `progress/current.md` está en plantilla limpia (no contiene la sesión
      que acaba de cerrar).

---

**Cómo usar:** el agente revisor (`.agents/skills/reviewer/SKILL.md`)
recorre cada checkbox, marca `[x]` o `[ ]`, y rechaza el cierre si quedan
boxes vacíos en C1–C5.
