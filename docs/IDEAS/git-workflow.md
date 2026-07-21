# Git Workflow — Preservación de Trabajo

> **Propósito**: Evitar pérdida de trabajo. Estas reglas son obligatorias para
> cualquier agente que opere sobre este repositorio.

---

## 1. El problema con `git stash`

`git stash` **no es un depósito permanente** por varias razones:
- Los stashes **no se sincronizan con GitHub** ni con ningún remoto.
- Si aplicás un stash creado en otra rama, pueden surgir conflictos difíciles
  de resolver porque el stash guarda el diff contra el HEAD original.
- `git stash` **no incluye archivos nuevos a menos que uses `--include-untracked`**
  (y la mayoría de los agentes olvida esta flag).

**Solución**: Si necesitás cambiar de contexto, **creá un commit en una rama
`wip/`** y pushealo a origin.

## 2. Flujo de trabajo diario

### 2.1 Empezar una sesión

```bash
git checkout -b wip/<feature-name>
```

### 2.2 Durante la sesión

Commits atómicos con mensajes descriptivos:

```bash
git add <archivos-específicos>
git commit -m "feat(domain): add part dimension calculation for base cabinets"
```

Reglas:
- **Un solo cambio lógico por commit.** No mezcles features distintas.
- Si tocás archivos de otra feature, commitealos por separado.
- Usa mensajes en inglés (el código es en inglés).
- Sigue [Conventional Commits](https://www.conventionalcommits.org/):
  `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`.

### 2.3 Cerrar sesión

**Siempre hacer `git push` antes de irte.**

```bash
git push origin wip/<feature-name>
```

HEAD local **debe ser igual a origin**. Si no hay cambios nuevos, no hay
problema — pero el push asegura que el trabajo sobrevive a una laptop que se
apaga, un SSD que falla, o un agente que pierde contexto.

### 2.4 Recuperar stash heredado

Si necesitás aplicar un stash creado por otro agente o sesión:

```bash
git stash apply --include-untracked
```

Sin `--include-untracked` los archivos nuevos se pierden y la compilación
se rompe silenciosamente.

## 3. Ramas

| Rama | Propósito | Base | ¿Se pushea? |
|------|-----------|------|-------------|
| `main` | Integración estable | — | Sí |
| `wip/<name>` | Trabajo en curso | `main` | Sí (siempre, al cerrar sesión) |
| `feat/<name>` | Features completas listas para review | `main` | Sí |

### 3.1 Política de `main`

- `main` siempre debe pasar `./init.sh`.
- No se pushea directamente a `main`. Siempre vía PR (o con revisión explícita
  del líder del proyecto).

## 4. ¿Qué se commitea?

| Archivo | ¿Commit? | Razón |
|---------|----------|-------|
| `.env.example` | ✅ Sí | Es el template documentado de variables necesarias |
| `.env` | ❌ No | Contiene secretos reales (DB pass, API keys) |
| `.env.local` | ❌ No | Ídem, sobreescritura local |
| `node_modules/` | ❌ No | En `.gitignore` — se regenera con `pnpm install` |
| `dist/`, `build/`, `out/` | ❌ No | Artefactos de build |
| `.freebuff/` | ❌ No | Cache local del asistente |

---

## 5. Qué NO hacer

| Acción | Riesgo | Alternativa |
|--------|--------|-------------|
| `git stash` como depósito | Se pierde el trabajo | Commit + push en rama `wip/` |
| `git add -A` sin revisar | Se commitean archivos no relacionados | `git add <archivos>` específicos |
| `git commit -m "fix"` | Imposible saber qué cambió | Mensaje descriptivo (`fix(domain): ...`) |
| No pushear al cerrar sesión | El trabajo queda solo en la máquina local | `git push origin wip/<name>` |
| Mezclar features en un commit | Imposible revertir una feature sin la otra | Commits atómicos por feature |

## 6. Resolución de conflictos

Si al hacer `git pull` (o al mergear) hay conflictos:

1. Identificá los archivos en conflicto con `git status`.
2. Resolvelos manualmente (o pedí ayuda al usuario).
3. `git add <archivos-resueltos>` y `git commit`.

**No uses `git stash` para resolver conflictos.** Usá `git merge --abort` si
necesitás salir del merge y resolverlo después.
