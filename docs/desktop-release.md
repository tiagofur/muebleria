# Release y Empaquetado Desktop — Muebles

Guía oficial para compilar, firmar y publicar la aplicación de escritorio (`@muebles/desktop`) para Windows, macOS y Linux.

---

## 1. Comandos de Empaquetado

Desde la raíz del monorepo:

| Comando | Acción | Salida |
|---|---|---|
| `pnpm build:desktop` | Empaqueta la app en modo directorio (`--dir`) para prueba rápida | `apps/desktop/dist/mac-arm64/` o `dist/win-unpacked/` |
| `pnpm release:desktop` | Genera instaladores completos para la plataforma actual | `apps/desktop/dist/*.dmg`, `*.exe`, `*.AppImage` |
| `pnpm --filter @muebles/desktop dist:win` | Genera instalador Windows (NSIS `.exe` + portable) | `apps/desktop/dist/Muebles-Setup-*.exe` |
| `pnpm --filter @muebles/desktop dist:mac` | Genera instalador macOS (`.dmg` + `.zip`) | `apps/desktop/dist/Muebles-*.dmg` |
| `pnpm --filter @muebles/desktop dist:linux` | Genera binarios Linux (`AppImage` + `.tar.gz`) | `apps/desktop/dist/Muebles-*.AppImage` |

---

## 2. Firma de Código (Code Signing)

> [!IMPORTANT]
> **Nunca** commitees certificados (`.pfx`, `.p12`, `.cer`) ni contraseñas al repositorio. Utiliza variables de entorno locales o GitHub Actions Secrets.

### A. Windows (Certificado Authenticode `.pfx`)
Para firmar el instalador `.exe` y evitar la advertencia de Windows SmartScreen:

Configura las siguientes variables de entorno antes de ejecutar `pnpm dist:win`:
```bash
export WIN_CSC_LINK="/ruta/segura/al/certificado.pfx"
export WIN_CSC_KEY_PASSWORD="tu_password_del_certificado"
```
Alternativamente, `electron-builder` soporta certificados en base64 en CI:
```bash
export WIN_CSC_LINK="data:application/x-pkcs12;base64,..."
```

### B. macOS (Apple Developer ID)
Para firmar y notarizar en macOS:
```bash
export CSC_LINK="/ruta/segura/al/DeveloperID.p12"
export CSC_KEY_PASSWORD="password_del_p12"
export APPLE_ID="tu-apple-id@dominio.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="TU_TEAM_ID"
```

---

## 3. Auto-Updater (GitHub Releases)

La aplicación integra `electron-updater` configurado contra el repositorio GitHub (`tiagofur/muebleria`).

### Flujo de Actualización:
1. Al iniciar la aplicación empaquetada (`app.isPackaged === true`), `autoUpdater.checkForUpdatesAndNotify()` consulta la API de GitHub Releases.
2. Si detecta una versión superior (según `package.json`), descarga el delta en segundo plano.
3. Al cerrar la aplicación, instala la nueva versión automáticamente sin requerir intervención del carpintero/usuario.

### Publicación de una Release:
1. Incrementa la versión en `apps/desktop/package.json` (ej: `1.0.1`).
2. Exporta el token de GitHub:
   ```bash
   export GH_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxx"
   ```
3. Ejecuta el build con el flag `--publish always`:
   ```bash
   cd apps/desktop && pnpm dist --publish always
   ```
4. `electron-builder` subirá los instaladores y el archivo de manifiesto `latest.yml` / `latest-mac.yml` directamente a GitHub Releases como borrador (*Draft*).
5. Revisa y publica el Release en GitHub.
