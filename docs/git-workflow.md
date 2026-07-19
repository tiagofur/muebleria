# Workflow Git — Preservación de trabajo

> Regla de oro: **si un cambio está solo en tu disco, está a un
> `rm -rf` (o un cierre malo de sesión) de perderse.** Lo que no está
> pushed a `origin` no existe.

Este doc existe porque en julio 2026 se perdieron (y se recuperaron por
suerte) varias semanas de trabajo 3D por **mal uso de `git stash`**.
Detalles en §Postmortem.

---

## 1. Cómo SÍ guardar trabajo

### Regla: commit > stash, siempre

El `stash` es **cazuela temporal** para mover trabajo entre ramas durante
una misma sesión. No es depósito a largo plazo. Si vas a cerrar la
sesión o cambiar de contexto, **commitealo en una rama WIP y pusheala.**

```bash
# Trabajo a medias que querés preservar entre sesiones:
git checkout -b wip/<tema>
git add -A
git commit -m "wip: <qué falta>, no rompe nada, incomplete"
git push -u origin wip/<tema>      # ← ya está en GitHub, seguro
```

Los commits en rama WIP **no ensucian** el historial: se squash-mergeuean
o borran después. Y son imposibles de perder mientras existan en
`origin`.

### Antes de declarar `done` (regla absoluta)

1. `pnpm test` (o `./init.sh`) verde.
2. Si cambió TS: `pnpm typecheck` verde.
3. Si cambiaste tipos: `pnpm typecheck` verde.
4. **Push a origin** antes de cerrar la sesión. HEAD local == origin.
5. Evidencia en `progress/current.md`.

Si rompés paso 1-3, dejá la rama en estado verde-committed (aunque sea
un `fixup!` temporal) antes de cerrar. Nunca te vayas con el repo en
estado rojo.

---

## 2. Cómo NO guardar trabajo

### ❌ No uses `git stash` para preservar trabajo entre sesiones

Los stashes:
- **No se sincronizan con GitHub.** Quedan atrapados en tu disco.
- **Se rompen al aplicar** si contienen archivos nuevos (untracked):
  `git stash apply` por defecto **NO restaura archivos untracked**.
  Esto fue exactamente lo que rompió el stack 3D en 2026-07 (ver §Postmortem).
- **Se acumulan y se pudren.** El repo llegó a tener 43 stashes en julio
  2026, varios duplicados del mismo trabajo, sin trazabilidad de qué era
  cada uno.

### ❌ No mezcles trabajo de features distintas en el mismo commit/stash

Si tu feature #N implica tocar archivos de la feature #M (trabajo
"ajeno"), **no lo guardes junto**. Opciones:

- Lo más limpio: abre otra rama para ese trabajo ajeno.
- Si el trabajo ajeno es pequeño y necesario: commitealo en su propio
  commit atómico con su mensaje claro (`feat(<otra-feature>): ...`), no
  lo mezcles en el commit de tu feature.
- Si tu implementer mezcló sin querer: **reportalo al líder** antes de
  seguir. "Mezcla involuntaria" como mensaje de stash es exactamente la
  receta para perderse.

### ❌ No uses `git reset --hard` sin haber hecho commit/push antes

Si vas a descartar cambios locales, **commitealos primero en una rama
`trash/` o `wip/` y pusheala**. Cuesta 10 segundos y te salva si
resulta que sí los necesitabas.

```bash
# ANTES de un reset --hard:
git stash push -u -m "antes-del-reset-<fecha>"  # peor opción
# o mejor:
git checkout -b trash/pre-reset-$(date +%Y%m%d)
git add -A && git commit -m "snapshot antes de descartar"
git push -u origin trash/pre-reset-$(date +%Y%m%d)
```

---

## 3. Cómo aplicar un stash (cuando sí lo uses)

Si heredaste un stash y tenés que aplicarlo, hacelo bien:

```bash
# SIEMPRE incluye --include-untracked si el stash podría tener archivos nuevos:
git stash apply --include-untracked stash@{0}

# O pop (lo aplica y lo borra del stash list):
git stash pop --index stash@{0}
```

Antes de aplicar, **inspeccioná** qué tiene:

```bash
git stash show -p stash@{0}                       # diff tracked
git stash show --include-untracked -p stash@{0}   # incluye untracked
git ls-tree -r --name-only stash@{0}^3            # lista solo untracked
git stash list                                    # todos los stashes
```

Si el stash mezcla cosas que no querés, **no lo apliques entero**. Hacé
checkout quirúrgico archivo por archivo (ver §Recuperación).

---

## 4. Recuperación: commits/stash "perdidos"

Git casi nunca borra nada. El `reflog` guarda 90 días de historia de
HEAD, **incluso commits colgados que ya no apunta ninguna rama**.

### Paso 1: encontrar el trabajo perdido

```bash
git reflog -50                          # historia de HEAD
git log --all --oneline --graph -50     # commits en cualquier rama
git stash list                          # stashes (incluye colgados)
git fsck --lost-found 2>&1 | grep commit # commits huérfanos
```

Buscá por mensaje:
```bash
git log --all --oneline --grep="<palabra>"
```

### Paso 2: traerlo a una rama

```bash
# Si es un commit colgado:
git checkout origin/main -b recover/<tema>
git cherry-pick <sha-del-commit>

# Si es un stash: extraé los archivos relevantes (no apliques entero si
# mezcla trabajo). Ejemplo del incidente 3D:
git checkout origin/main -b recover/3d
git checkout stash@{0} -- packages/ui/src/<archivo1> packages/ui/src/<archivo2>
git show stash@{0}^3:packages/ui/src/<nuevo-archivo> > packages/ui/src/<nuevo-archivo>
```

### Paso 3: verificación antes de pushear

```bash
pnpm typecheck     # si cambiaste tipos
pnpm test          # o ./init.sh
git push -u origin recover/<tema>
```

**Nunca closes la sesión de recuperación sin `git push`.** El trabajo
recuperado en tu disco sigue siendo frágil hasta que llega a origin.

### Backup físico como red de seguridad

Si la recuperación es delicada, exportá los objetos a `.patch` en `/tmp`
**antes** de tocar nada:

```bash
mkdir -p /tmp/backup-<tema>
git stash show -p stash@{0} > /tmp/backup-<tema>/stash0.patch
git format-patch -1 <sha> -o /tmp/backup-<tema>/
# Y los untracked (archivos nuevos del stash):
for f in $(git ls-tree -r --name-only stash@{0}^3); do
  mkdir -p "/tmp/backup-<tema>/$(dirname "$f")"
  git show "stash@{0}^3:$f" > "/tmp/backup-<tema>/$f"
done
```

---

## 5. Higiene de ramas y stashes

### Stashes

- Idealmente: **cero stashes** persistentes. Si existe un stash con más
  de 2 días, commitealo en una rama `wip/` y borrá el stash.
- Antes de borrar un stash: asegurarte que su contenido está commiteado
  en una rama pushed. Stash aplicado + commit + push = podés borrar
  seguro con `git stash drop stash@{N}`.

### Ramas

- `main` es **solo merges vía PR** desde `origin`. Nunca commitear
  directo.
- Ramas de feature: `feat/<slug>-<issue>` o `fix/<slug>-<issue>`.
- Ramas WIP: `wip/<tema>` — para snapshots incompletos pushed.
- Ramas de recuperación: `recover/<tema>`.
- Hacé `git fetch --all --prune` al arrancar la sesión para ver el
  estado real de origin.

### Push frecuente

Empujar rama WIP no es vergüenza. Es **seguro**. Preferí 5 pushes por
sesión a perder 2 horas de trabajo.

---

## 6. Postmortem: incidente 3D (2026-07)

### Qué pasó

El stack 3D con React Three Fiber (`preview3d/*`) estaba commiteado en
`main`. Después, trabajo adicional de cámara 3D (vistas
frontal/superior/lateral/isométrica, proyección ortogonal/perspectiva,
wireframe, migración de editores de CSS a R3F) **se mezcló
involuntariamente** con trabajo del #108 en un solo stash:

```
stash@{0}: WIP-MIXED-before-slice4-clean: parcial #108 slice4
  (sin cablear) + 3D camera/material ajeno + Part3DViewer->Furniture3DViewer
  + playwright visual tests + judgment-day-ui doc + backend-go/data media
```

### Por qué se "perdía" al día siguiente

El stash contenía un **archivo nuevo** (`packages/ui/src/common/Furniture3DViewer.tsx`)
junto a cambios tracked. Cuando alguien intentaba aplicarlo con
`git stash apply` (sin `--include-untracked`):

1. Se restauraban los 12 archivos tracked (los editores migrados).
2. **NO** se restauraba `Furniture3DViewer.tsx` (era untracked).
3. Los editores migrados hacían `import { Furniture3DViewer } from ...`
   pero el archivo no existía → **TypeScript rompía**.
4. Se revertía la migración parcial. Al día siguiente, vuelta a empezar.

### Cómo se recuperó

1. **Backup físico primero**: 5 stashes + 1 commit colgado exportados a
   `.patch` y árboles untracked en `/tmp/muebles-3d-backup/`.
2. Rama nueva `feat/3d-r3f-recovery` desde `origin/main`.
3. **Checkout quirúrgico**: solo los 14 archivos 3D relevantes, dejando
   fuera medias `.jpg`, docs del #108, tests playwright y otros.
4. `App.tsx` reconciliado a mano (solo cambió 1 línea desde la base del
   stash).
5. `pnpm typecheck` + `pnpm test` (311+87+9 = 407 tests) + `pnpm build`
   verdes.
6. Commit + **push** a `origin/feat/3d-r3f-recovery`.

Commit de recuperación: `f788c4c`.

### Lecciones (ahora reglas en este doc)

1. **Stash no es depósito.** El trabajo que vivía en stash@{0} debería
   haber sido rama WIP pushed desde el día 1.
2. **Nunca mezclar features en un stash/commit.** El mensaje
   "WIP-MIXED" lo dice todo.
3. **`--include-untracked` SIEMPRE** al aplicar stashes heredados.
4. **Push frecuente** a ramas WIP, incluso si están incompletas.
5. **El reflog casi siempre tiene la respuesta.** Antes de declarar algo
   "perdido", correr `git reflog`, `git fsck --lost-found` y buscar en
   todos los stashes.

---

## Referencias rápidas

| Necesito | Comando |
|----------|---------|
| Ver stashes | `git stash list` |
| Inspeccionar stash (sin aplicar) | `git stash show -p stash@{0}` |
| Inspeccionar stash + untracked | `git stash show --include-untracked -p stash@{0}` |
| Listar archivos untracked de un stash | `git ls-tree -r --name-only stash@{0}^3` |
| Aplicar stash completo | `git stash apply --include-untracked stash@{0}` |
| Buscar commit perdido | `git reflog -50` · `git log --all --oneline --grep="…"` |
| Commits huérfanos | `git fsck --lost-found` |
| Crear rama de recuperación | `git checkout origin/main -b recover/<tema>` |
| Snapshot WIP pushed | `git add -A && git commit -m "wip: …" && git push -u origin wip/<tema>` |
