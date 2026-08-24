# Sesión

**Feature en curso:** F160 — sketchup_extension_bootstrap (issue #345)
**Inicio:** 2026-08-24
**Estado:** in_progress — correcciones round 1 aplicadas; pendiente review round 2 y host smoke
**Rama:** `codex/345-sketchup-extension-bootstrap`
**Worktree:** `/Users/tiagofur/dev/carpinteria/muebles-worktrees/sketchup-extension-bootstrap`

## Plan de corrección (estado)

- [x] Sincronizado con `origin/main` (base `ddb19a0`); #345 reasignado al ID
  libre F160; ledger/evidencia/historia reconciliados.
- [x] Rename de marca **Muebles → Granete** en el entregable de la extensión:
  namespace `Granete::SketchUpExtension`, `granete_for_sketchup.rb`/`,
  RBZ `granete_for_sketchup.rbz`, dialog, README, ledger. El rename
  repo-wide (docs, web, backend) queda como issue separado.
- [x] Cleanup conectado al callback real `AppObserver#onUnloadExtension`
  (`AppLifecycleObserver` registrado por `Runtime.start`); uncheck documentado
  como no-unload. TestUp prueba sólo la instalación RBZ (fail-closed por
  nombre/versión/loaded/path en Plugins, rechaza el checkout).
- [x] Redaction endurecida (POSIX/Windows/UNC con espacios, URLs con
  credenciales, mínimo de substitución 4) con tests adversariales;
  ownership/dependency/wiring guards mutation-resistant (word boundaries,
  todas las formas de require, wiring test de `main.rb`).
- [x] SketchUp 2026.2 macOS como único target #345; el resto compatibilidad
  planificada sin implied support (README + ledger).
- [x] UI: estado de conexión coherente (heading+mensaje+state inyectados
  juntos), color tokenizado, CI Ruby/RBZ en ubuntu/macOS/Windows.
- [x] Historia reestructurada en cinco work units encadenables, gates
  read-only finales y push `--force-with-lease`.

## Invariante

**SketchUp owns authoring/interaction; Granete owns manufacturing truth.** Ruby no
calcula BOM, partes resueltas, joints, drilling, nesting, kerf, preflight/release ni
postprocessing.

## Evidencia pendiente

- Review round 2 sobre la rama corregida (round 1: CHANGES_REQUESTED en
  `progress/review_F160_round1.md`).
- El líder ejecutará el host smoke en SketchUp 2026.2 macOS (instalación RBZ,
  open/close/recreate, disable/enable/uninstall + restart, TestUp JSON,
  versiones y SHA). Hasta entonces no se reclama pass de instalación, unload,
  render CEF, TestUp ni soporte del host.
