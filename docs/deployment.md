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
CORS_ALLOWED_ORIGINS=https://app.granete.io
RATE_LIMIT_RPS=0.5
RATE_LIMIT_BURST=10
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

El backend Go no crea cuentas por defecto al arrancar. Ejecuta el CLI administrativo dentro del contenedor:

```bash
docker compose -f docker-compose.prod.yml exec backend \
  /app/admin create --email admin@granete.io --name "Super Admin" --role admin --platform-admin
```

El CLI te solicitará la contraseña de forma segura sin eco en terminal.

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

Configurar un cron job nocturno para exportar la base de datos y rotar copias de los últimos 14 días:

1. Crear el script de backup en `/usr/local/bin/backup-granete.sh`:

```bash
cat << 'EOF' > /usr/local/bin/backup-granete.sh
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/var/backups/granete"
DATE=$(date +'%Y-%m-%d_%H%M%S')
mkdir -p "$BACKUP_DIR"

cd /opt/granete
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U granete_prod -d granete_prod -F c | gzip > "$BACKUP_DIR/granete_$DATE.sql.gz"

# Backup del volumen de medios (imágenes de catálogo por organización)
docker run --rm \
  -v granete_media_data:/data:ro \
  -v "$BACKUP_DIR":/backup \
  alpine tar czf "/backup/granete_media_$DATE.tar.gz" -C /data .

# Eliminar backups de más de 14 días
find "$BACKUP_DIR" -name "granete_*.sql.gz" -mtime +14 -delete
find "$BACKUP_DIR" -name "granete_media_*.tar.gz" -mtime +14 -delete

echo "Backup completado exitosamente: $BACKUP_DIR/granete_$DATE.sql.gz + media"
EOF

chmod +x /usr/local/bin/backup-granete.sh
```

2. Agregar la tarea a crontab:

```bash
(crontab -l 2>/dev/null; echo "0 3 * * * /usr/local/bin/backup-granete.sh >> /var/log/granete-backup.log 2>&1") | crontab -
```

### 5.3 Actualización de Versión (Deploy Rolling)

Para actualizar a una nueva versión del código sin pérdida de datos:

```bash
cd /opt/granete

# 1. Obtener los últimos cambios de git
git pull origin main

# 2. Reconstruir frontend y backend y reiniciar servicios
docker compose -f docker-compose.prod.yml --env-file .env up -d --build

# 3. Las migraciones de base de datos se ejecutan automáticamente en el arranque del backend
docker compose -f docker-compose.prod.yml logs --tail=50 backend
```

---

## 6. Recuperación ante Desastres (Disaster Recovery)

Para restaurar una copia de seguridad:

```bash
# 1. Detener el backend para evitar escrituras concurrentes
docker compose -f docker-compose.prod.yml stop backend

# 2. Restaurar el dump en PostgreSQL
gunzip -c /var/backups/granete/granete_YYYY-MM-DD_HHMMSS.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U granete_prod -d granete_prod --clean --if-exists

# 3. Reiniciar el backend
docker compose -f docker-compose.prod.yml start backend
```
