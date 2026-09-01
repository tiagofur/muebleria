# Granete — Guía Operativa de Despliegue en VPS (Producción)

> **Documento canónico de infraestructura y operaciones (F174 / #412).**
> Describe el aprovisionamiento, despliegue, seguridad, copias de seguridad y ciclo de vida de Granete en un servidor VPS dedicado.

---

## 1. Arquitectura de Producción

El stack de producción está empaquetado en contenedores Docker orquestados por `docker-compose.prod.yml`:

```text
               Internet (HTTPS 443 / HTTP 80 / HTTP/3 443-UDP)
                                  │
                         ┌────────▼────────┐
                         │   Caddy 2.8     │ (TLS automático, HSTS, Gzip/Zstd,
                         │ (Reverse Proxy) │  SPA Static Files & Header Security)
                         └───┬─────────┬───┘
                             │         │
               /api/*, /media/*         Static Assets (/srv)
                             │
                     ┌───────▼────────┐
                     │ Go Backend API │ (Multi-stage Alpine, Go 1.22,
                     │  (Puerto 8080) │  Migraciones embebidas al boot)
                     └───────┬────────┘
                             │ (Red interna privada)
                     ┌───────▼────────┐
                     │ PostgreSQL 16  │ (Volumen persistente,
                     │    (Alpine)    │  Healthchecks automáticos)
                     └────────────────┘
```

---

## 2. Requisitos Previos del Servidor

- **Hardware mínimo recomendado**:
  - 2 vCPU / 4 GB RAM (apto para 10–20 talleres concurrentes).
  - 40 GB SSD / NVMe (con backups offsite).
- **Sistema Operativo**:
  - Ubuntu 22.04 LTS / 24.04 LTS o Debian 12 (Bookworm).
- **Dominio y DNS**:
  - Registro DNS tipo `A` apuntando `app.granete.io` (o el dominio asignado) a la IP pública del VPS.
  - Puertos 80 (TCP), 443 (TCP/UDP) y 22 (SSH) abiertos.

---

## 3. Preparación Inicial del VPS

### 3.1 Actualización del sistema y firewall

```bash
# Conectar al VPS como root
ssh root@tu-ip-vps

# Actualizar repositorios y paquetes
apt update && apt upgrade -y

# Instalar utilidades esenciales
apt install -y curl git ufw htop ca-certificates gnupg

# Configurar Firewall UFW (Seguridad estricta)
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP (Caddy ACME challenge)
ufw allow 443/tcp   # HTTPS
ufw allow 443/udp   # HTTP/3 QUIC
ufw enable
```

### 3.2 Instalación de Docker y Docker Compose

```bash
# Agregar la clave GPG oficial de Docker
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

# Agregar el repositorio de Docker a las fuentes de APT
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Habilitar servicio Docker
systemctl enable --now docker
```

---

## 4. Despliegue de Granete

### 4.1 Clonar el repositorio y configurar variables de entorno

```bash
# Crear directorio de despliegue
mkdir -p /opt/granete && cd /opt/granete

# Clonar el repositorio
git clone https://github.com/tiagofur/muebleria.git .

# Crear el archivo .env a partir de la plantilla de producción
cp .env.production.example .env

# Generar secretos criptográficos reales
JWT_SECRET_GEN=$(openssl rand -base64 48)
REFRESH_TOKEN_PEPPER_GEN=$(openssl rand -base64 48)
MEDIA_SIGNING_KEY_GEN=$(openssl rand -base64 48)
DB_PASS_GEN=$(openssl rand -base64 32)

# Editar el archivo .env con los valores de tu dominio y secretos
nano .env
```

Asegúrate de que `.env` contenga:
```ini
DOMAIN=app.granete.io
POSTGRES_USER=granete_prod
POSTGRES_PASSWORD=tu_password_generado
POSTGRES_DB=granete_prod
JWT_SECRET=tu_jwt_secret_generado
REFRESH_TOKEN_PEPPER=tu_pepper_refresh_independiente
MEDIA_SIGNING_KEY=tu_media_signing_key_independiente
CORS_ALLOWED_ORIGINS=https://app.granete.io
RATE_LIMIT_RPS=0.5
RATE_LIMIT_BURST=10
MEDIA_DIR=/data/media
```

Proteger permisos del archivo de configuración:
```bash
chmod 600 .env
```

### 4.2 Construir e Iniciar los Servicios

```bash
# Construir imágenes e iniciar contenedores en segundo plano
docker compose -f docker-compose.prod.yml --env-file .env up -d --build

# Verificar el estado de los contenedores
docker compose -f docker-compose.prod.yml ps
```

### 4.3 Inicializar el Administrador Global (SuperAdmin)

El backend Go no crea cuentas por defecto al arrancar. Ejecuta el CLI administrativo dentro del contenedor. Son **dos pasos** separados:

```bash
# Paso 1: Crear el usuario admin
docker compose -f docker-compose.prod.yml exec backend \
  /app/admin create --email admin@granete.io --name "Super Admin"

# Paso 2: Promoverlo a platform admin (consola /platform)
docker compose -f docker-compose.prod.yml exec backend \
  /app/admin create-platform-admin --email admin@granete.io
```

El CLI solicitará la contraseña de forma segura sin eco en terminal.

### 4.4 Verificar que todo funciona

```bash
# Verificar healthcheck del backend
docker compose -f docker-compose.prod.yml exec backend \
  wget -q --spider http://localhost:8080/api/health

# Verificar logs de arranque
docker compose -f docker-compose.prod.yml logs --tail=20 backend
```

### 4.5 Datos demo (opcional y explícito)

**Política:** ni las migraciones ni el arranque del backend insertan NUNCA
datos de negocio (materiales, componentes, módulos, clientes, cotizaciones…).
Una instalación fresca queda vacía y lista para el onboarding real del taller
(`docs/pilot-onboarding.md`). Esto está pineado por
`TestMigrations_NoBusinessData` — ninguna migración puede volver a sembrar
ítems.

El catálogo demo (plantilla: tableros, herrajes, módulos, clientes y obra
"Demo plantilla") existe sólo como **comando explícito**, para cuando quieras
una base con datos para probar o expandir:

```bash
# Dentro del contenedor (o en local contra la DB destino):
docker compose -f docker-compose.prod.yml exec backend /app/admin seed
#   o, desde el repo:  cd backend-go && go run ./cmd/admin seed

# Por API (requiere sesión de taller con rol que muta catálogo):
curl -X POST https://TU_HOST/api/seed -H "Authorization: Bearer <token>"
```

El seed es idempotente (si la organización ya tiene tableros, no duplica) y
sembría UNA organización: `admin seed --org <slug>` (por defecto la inicial).
Para un taller piloto real NO lo corras: el flujo canónico es clonar el
catálogo base desde la consola de plataforma.

**Limpiar el demo** (F181): `admin clean-demo-data [--apply] [--org <slug>]`.
Dry-run por defecto — reporta exactamente qué borraría sin tocar nada; con
`--apply` elimina todos los rows del seed (catálogo demo, clientes "Cliente
Plantilla"/"Cliente Demo", obra "Demo plantilla", template "Cocina estándar
3 m") en la organización indicada —o en todas—. Cualquier row demo que data
REAL referencie (obras, plantillas o módulos del usuario) se conserva y se
reporta como skipped. Ejemplo de ciclo completo sobre una base de prueba:

```bash
go run ./cmd/admin clean-demo-data            # 1. revisar el reporte
go run ./cmd/admin clean-demo-data --apply    # 2. borrar el demo
go run ./cmd/admin seed                       # 3. (opcional) volver a sembrar
```

> Histórico: `admin seed` comenzaba con un `TRUNCATE` global que borraba el
> catálogo de TODAS las organizaciones antes de sembrar (y su backfill de
> owners cruzaba orgs). Desde F181 ya no trunca — respeta lo existente y el
> reset explícito es `clean-demo-data`.

---

## 5. Mantenimiento y Operaciones Diarias

### 5.1 Verificación de Logs en Tiempo Real

```bash
# Ver logs del backend
docker compose -f docker-compose.prod.yml logs -f backend

# Ver logs de acceso y certificados de Caddy
docker compose -f docker-compose.prod.yml logs -f caddy

# Ver logs de la base de datos
docker compose -f docker-compose.prod.yml logs -f postgres
```

### 5.2 Copias de Seguridad Automatizadas (Backups)

El script versionado `scripts/backup.sh` ejecuta backup de **PostgreSQL y media** con rotación automática.

1. Copiar el script al VPS (o ejecutarlo desde el repo clonado):

```bash
# Desde /opt/granete
scripts/backup.sh

# Opciones:
#   --db-only              Solo PostgreSQL
#   --media-only           Solo archivos media
#   --retention-days=7     Rotación personalizada
#   BACKUP_DIR=/otra/ruta  Directorio de destino
```

2. Configurar un cron job nocturno:

```bash
(crontab -l 2>/dev/null; echo "0 3 * * * /opt/granete/scripts/backup.sh >> /var/log/granete-backup.log 2>&1") | crontab -
```

3. Verificar que el backup funciona:

```bash
scripts/backup.sh --dry-run  # Solo muestra el plan, no ejecuta
scripts/backup.sh            # Ejecuta el backup completo
ls -la /var/backups/granete/  # Ver archivos generados
```

**Nota importante**: `scripts/backup.sh` cubre PostgreSQL Y archivos media. Antes de este cambio, el backup inline del runbook solo protegía PostgreSQL y afirmaba que era un backup completo sin incluir los archivos de catálogo e imágenes de proyectos. Los scripts versionados corrigen esto.

### 5.3 Actualización de Versión (Deploy Rolling)

Para actualizar a una nueva versión del código sin pérdida de datos:

```bash
cd /opt/granete

# 1. Obtener los últimos cambios de git
git pull origin main

# 2. PASO OBLIGATORIO: gate de Pilot Readiness (aislamiento multi-org + backup/restore).
#    Sin DB alcanzable FALLA — nunca desplegar con el gate en rojo (docs/pilot-readiness.md).
scripts/pilot-gate.sh --fresh-container   # o --dsn postgres://… contra una base de staging

# 3. Reconstruir frontend y backend y reiniciar servicios
docker compose -f docker-compose.prod.yml --env-file .env up -d --build

# 4. Las migraciones de base de datos se ejecutan automáticamente en el arranque del backend
docker compose -f docker-compose.prod.yml logs --tail=50 backend
```

### 5.4 Rollback

Si una actualización causa problemas, revertir a una versión anterior:

```bash
cd /opt/granete

# 1. Identificar la versión anterior (commit hash o tag)
git log --oneline -5

# 2. Revertir al código conocido
git checkout <commit-hash-or-tag>

# 3. Reconstruir y reiniciar
docker compose -f docker-compose.prod.yml --env-file .env up -d --build

# 4. Verificar que el backend arranca correctamente
docker compose -f docker-compose.prod.yml logs --tail=20 backend

# 5. Si hay migraciones nuevas en la versión rota que no se pueden revertir,
#    restaurar la base de datos desde el último backup conocido (ver §6)
```

**Nota**: Las migraciones de base de datos son unidireccionales. Si la versión rota aplicó migraciones nuevas, el rollback de código puede dejar la DB in-compatible. En ese caso, restaurar desde backup con `scripts/restore.sh` es la ruta segura.

---

## 6. Recuperación ante Desastres (Disaster Recovery)

Para restaurar una copia de seguridad completa (PostgreSQL + archivos media):

### 6.1 Restauración completa

```bash
cd /opt/granete

# Ver qué backups existen
ls -la /var/backups/granete/

# Restaurar (reemplaza DB actual y archivos media)
scripts/restore.sh /var/backups/granete/granete_YYYY-MM-DD_HHMMSS.sql.gz
```

El script `restore.sh` ejecuta automáticamente:
1. Backup de seguridad de la DB actual (por si acaso).
2. Detiene el backend para evitar escrituras concurrentes.
3. Restaura PostgreSQL con `pg_restore`.
4. Restaura archivos media al volumen Docker.
5. Corrige permisos de ownership (appuser:appgroup).
6. Reinicia el backend.
7. Verifica que el healthcheck responda.
8. Reporta conteo de tablas y archivos media vs URLs en DB (para detectar huérfanos).

### 6.2 Verificación post-restore

Después de restaurar, verificar manualmente:

1. Abrir la aplicación en el navegador y verificar que carga.
2. Iniciar sesión como admin.
3. Revisar que las imágenes de catálogo aparezcan (no broken images).
4. Si hay URLs huérfanas (archivos perdidos), limpiarlas:

```bash
docker compose -f docker-compose.prod.yml exec backend \
  /app/admin clean-media --apply
```

### 6.3 Qué cubre y qué NO cubre el restore

| Componente | Cubierto | Notas |
|-----------|----------|-------|
| PostgreSQL (todos los datos) | ✅ | `pg_restore --clean --if-exists` |
| Archivos media (catálogo, fotos) | ✅ | Volumen `granete_media_data` |
| Caddy certificates | ❌ | Caddy los regenera automáticamente via ACME |
| Docker images | ❌ | Re-build con `--build` en el compose |
| Configuración `.env` | ❌ | Nunca se backup (secrets); re-crear manualmente |

---

## 7. Estrategia de Copias de Seguridad Offsite

Las copias locales en el VPS no protegen contra fallo del disco o pérdida del servidor.

**Recomendaciones para talleres piloto (2–5 instancias):**

```bash
# Opción A: rsync a un segundo servidor (recomendado)
# Configurar SSH key-based auth al servidor de backup
rsync -avz --delete /var/backups/granete/ user@backup-server:/backups/granete/

# Opción B: Upload a bucket S3-compatible (MinIO, Backblaze B2, etc.)
aws s3 sync /var/backups/granete/ s3://mi-bucket-granete/backups/ \
  --storage-class STANDARD_IA

# Opción C: Copia a disco USB externo (mínimo viable)
mount /dev/sdb1 /mnt/usb
rsync -avz /var/backups/granete/ /mnt/usb/granete-backup/
umount /mnt/usb
```

**Frecuencia recomendada**: sincronizar offsite al menos una vez por día (puede ser otro cron job con rsync). Para talleres piloto, un rsync diario al segundo servidor es suficiente.

---

## 8. Variables de Entorno — Referencia

| Variable | Requerida | Default | Descripción |
|----------|-----------|---------|-------------|
| `DOMAIN` | Sí | `localhost` | Dominio público (Caddy TLS + CORS) |
| `POSTGRES_USER` | Sí | `granete_prod` | Usuario PostgreSQL |
| `POSTGRES_PASSWORD` | Sí | — | Contraseña PostgreSQL (requerida) |
| `POSTGRES_DB` | Sí | `granete_prod` | Nombre de la base de datos |
| `JWT_SECRET` | Sí | — | Secreto JWT, >= 32 bytes (requerida) |
| `REFRESH_TOKEN_PEPPER` | Sí | — | Pepper independiente >= 32 bytes para HMAC-SHA-256 de refresh credentials; rotarlo revoca refresh y requiere re-login coordinado |
| `MEDIA_SIGNING_KEY` | Sí | — | Key independiente >= 32 bytes (#460 SEC-3) para firmar media grants `media_read` de 3 minutos por recurso exacto; rotarla sólo invalida grants en vuelo |
| `CORS_ALLOWED_ORIGINS` | Sí | — | Orígenes CORS permitidos, separados por coma |
| `RATE_LIMIT_RPS` | No | `0.2` | Requests/segundo para auth endpoints |
| `RATE_LIMIT_BURST` | No | `5` | Burst máximo para auth endpoints |
| `MEDIA_DIR` | No | `/data/media` | Ruta del directorio de media dentro del contenedor |
| `PORT` | No | `8080` | Puerto del backend |

**Generar secretos seguros:**
```bash
JWT_SECRET=$(openssl rand -base64 48)
REFRESH_TOKEN_PEPPER=$(openssl rand -base64 48)
POSTGRES_PASSWORD=$(openssl rand -base64 32)
```

**Nota sobre `sslmode`**: La conexión entre el backend y PostgreSQL dentro de Docker usa `sslmode=disable` porque ambos contenedores están en la misma red interna. Esto es seguro. Para conexiones externas a la base de datos (psql desde el host), usar `sslmode=require`.

---

## 9. Seguridad

- **Firewall**: Solo puertos 22, 80, 443 abiertos (UFW).
- **Secretos**: Nunca en el repositorio. `JWT_SECRET`, `REFRESH_TOKEN_PEPPER` y `POSTGRES_PASSWORD` generados independientemente con `openssl rand`.
- **Permisos**: `.env` con `chmod 600`, backups con `chmod 700` en directorio.
- **TLS**: Certificados automáticos via Caddy/ACME. HSTS habilitado (1 año).
- **CORS**: Allowlist explícita, nunca wildcard.
- **Rate limiting**: En endpoints de auth (login, register).
- **Healthcheck**: `/api/health` endpoint sin autenticación para monitoreo.
- **Admin CLI**: Contraseña sin eco en terminal, no se imprime en logs.
