#!/usr/bin/env bash
set -Eeuo pipefail

# Reptoc production installer for Debian 12 / Ubuntu 22.04 and newer.
# Run as root from the extracted Reptoc-WebnovelPlatform directory.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
INSTALL_DIR="${INSTALL_DIR:-/opt/reptoc}"
APP_USER="${APP_USER:-reptoc}"
APP_PORT="${APP_PORT:-3000}"
DB_NAME="${DB_NAME:-reptoc}"
DB_USER="${DB_USER:-reptoc}"
DOMAIN="${DOMAIN:-}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
DATABASE_URL="${DATABASE_URL:-}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
ENABLE_NGINX="${ENABLE_NGINX:-1}"
ENABLE_SSL="${ENABLE_SSL:-0}"
NON_INTERACTIVE="${NON_INTERACTIVE:-0}"
LOG_FILE="/var/log/reptoc-installer.log"

export DEBIAN_FRONTEND=noninteractive

info() { printf '\033[1;34m[reptoc] %s\033[0m\n' "$*" | tee -a "$LOG_FILE"; }
ok() { printf '\033[1;32m[reptoc] %s\033[0m\n' "$*" | tee -a "$LOG_FILE"; }
warn() { printf '\033[1;33m[reptoc] WARNING: %s\033[0m\n' "$*" | tee -a "$LOG_FILE" >&2; }
die() { printf '\033[1;31m[reptoc] ERROR: %s\033[0m\n' "$*" | tee -a "$LOG_FILE" >&2; exit 1; }

on_error() {
  local exit_code=$?
  printf '\033[1;31m[reptoc] Installation failed at line %s. See %s\033[0m\n' "${BASH_LINENO[0]:-unknown}" "$LOG_FILE" >&2
  exit "$exit_code"
}
trap on_error ERR

usage() {
  cat <<'EOF'
Usage: sudo ./installer.sh [options]

Options:
  --domain NAME             Public domain or server IP (required)
  --install-dir PATH        Deployment directory (default: /opt/reptoc)
  --port NUMBER             Local application port (default: 3000)
  --admin-user NAME         Initial owner username (default: admin)
  --admin-email EMAIL       Initial owner email
  --admin-password PASS     Initial owner password (minimum 16 characters)
  --database-url URL        Use an existing PostgreSQL database
  --db-name NAME            Local database name (default: reptoc)
  --db-user NAME            Local database role (default: reptoc)
  --ssl                     Request a Let's Encrypt certificate (requires DNS)
  --certbot-email EMAIL     Email used by Let's Encrypt
  --no-nginx                Do not install/configure Nginx
  --non-interactive         Accept defaults; missing secrets are generated
  -h, --help                Show this help

The same settings may be supplied as uppercase environment variables. This is a
fresh-server installer; it refuses to overwrite an existing Reptoc .env.
EOF
}

while (($#)); do
  case "$1" in
    --domain) DOMAIN="${2:?Missing domain}"; shift 2 ;;
    --install-dir) INSTALL_DIR="${2:?Missing install path}"; shift 2 ;;
    --port) APP_PORT="${2:?Missing port}"; shift 2 ;;
    --admin-user) ADMIN_USERNAME="${2:?Missing username}"; shift 2 ;;
    --admin-email) ADMIN_EMAIL="${2:?Missing email}"; shift 2 ;;
    --admin-password) ADMIN_PASSWORD="${2:?Missing password}"; shift 2 ;;
    --database-url) DATABASE_URL="${2:?Missing database URL}"; shift 2 ;;
    --db-name) DB_NAME="${2:?Missing database name}"; shift 2 ;;
    --db-user) DB_USER="${2:?Missing database user}"; shift 2 ;;
    --certbot-email) CERTBOT_EMAIL="${2:?Missing email}"; shift 2 ;;
    --ssl) ENABLE_SSL=1; shift ;;
    --no-nginx) ENABLE_NGINX=0; shift ;;
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "Run this installer as root: sudo ./installer.sh"
[[ -r "$SCRIPT_DIR/package.json" && -r "$SCRIPT_DIR/postgres_schema.sql" ]] || die "Run the installer from the complete Reptoc package."
[[ -f /etc/os-release ]] || die "This installer supports Debian/Ubuntu servers."
. /etc/os-release
[[ "${ID:-}" == "debian" || "${ID:-}" == "ubuntu" || "${ID_LIKE:-}" == *debian* ]] || die "Unsupported OS: ${PRETTY_NAME:-unknown}. Use Debian 12 or Ubuntu 22.04+."
[[ "$INSTALL_DIR" == /* && "$INSTALL_DIR" != "/" ]] || die "INSTALL_DIR must be an absolute path other than /."
[[ "$INSTALL_DIR" != *[[:space:]]* ]] || die "INSTALL_DIR cannot contain whitespace."
[[ ! -f "$INSTALL_DIR/.env" ]] || die "An existing Reptoc installation was found at $INSTALL_DIR. Back it up and perform an upgrade instead of a fresh install."
[[ "$APP_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || die "APP_USER is invalid."
[[ "$DB_NAME" =~ ^[a-z_][a-z0-9_]*$ ]] || die "DB_NAME is invalid."
[[ "$DB_USER" =~ ^[a-z_][a-z0-9_]*$ ]] || die "DB_USER is invalid."
[[ "$ADMIN_USERNAME" =~ ^[A-Za-z0-9_]{3,32}$ ]] || die "Admin username must be 3-32 letters, digits, or underscores."
[[ "$APP_PORT" =~ ^[0-9]+$ ]] && ((APP_PORT >= 1024 && APP_PORT <= 65535)) || die "Port must be between 1024 and 65535."

if [[ "$NON_INTERACTIVE" != 1 ]]; then
  if [[ -z "$DOMAIN" ]]; then
    read -r -p "Public domain or server IP: " DOMAIN
  fi
  if [[ -z "$ADMIN_EMAIL" ]]; then
    read -r -p "Owner email (optional): " ADMIN_EMAIL
  fi
  if [[ -z "$ADMIN_PASSWORD" ]]; then
    read -r -s -p "Owner password (leave blank to generate one): " ADMIN_PASSWORD
    printf '\n'
  fi
  if [[ -n "$DOMAIN" && "$ENABLE_SSL" != 1 ]]; then
    read -r -p "Configure free HTTPS with Let's Encrypt? [y/N] " reply
    [[ "$reply" =~ ^[Yy]$ ]] && ENABLE_SSL=1
  fi
  if [[ "$ENABLE_SSL" == 1 && -z "$CERTBOT_EMAIL" ]]; then
    read -r -p "Let's Encrypt email: " CERTBOT_EMAIL
  fi
fi

DOMAIN="${DOMAIN#http://}"
DOMAIN="${DOMAIN#https://}"
DOMAIN="${DOMAIN%%/*}"
[[ -n "$DOMAIN" ]] || die "A public domain or server IP is required. Use --domain in non-interactive mode."
[[ "$DOMAIN" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$ ]] || die "Invalid domain name or server IP."
is_ipv4=0
if [[ "$DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  is_ipv4=1
  IFS=. read -r ip1 ip2 ip3 ip4 <<<"$DOMAIN"
  for octet in "$ip1" "$ip2" "$ip3" "$ip4"; do
    ((10#$octet >= 0 && 10#$octet <= 255)) || die "Invalid server IP."
  done
fi
if [[ "$ENABLE_SSL" == 1 ]]; then
  [[ "$ENABLE_NGINX" == 1 ]] || die "--ssl requires Nginx."
  [[ -n "$DOMAIN" ]] || die "--ssl requires --domain."
  [[ "$is_ipv4" == 0 ]] || die "Automatic Let's Encrypt setup requires a domain name, not an IP address."
  [[ "$CERTBOT_EMAIL" == *@* ]] || die "--ssl requires a valid --certbot-email."
fi

generated_admin_password=0
if [[ -z "$ADMIN_PASSWORD" ]]; then
  ADMIN_PASSWORD="$(openssl rand -hex 12)"
  generated_admin_password=1
fi
(( ${#ADMIN_PASSWORD} >= 16 )) || die "Owner password must contain at least 16 characters."
[[ "$ADMIN_PASSWORD" != *$'\n'* && "$ADMIN_PASSWORD" != *$'\r'* ]] || die "Owner password cannot contain a newline."

info "Installing operating-system dependencies"
apt-get update >>"$LOG_FILE" 2>&1
apt-get install -y ca-certificates curl gnupg openssl rsync build-essential postgresql postgresql-client >>"$LOG_FILE" 2>&1
if [[ "$ENABLE_NGINX" == 1 ]]; then
  apt-get install -y nginx >>"$LOG_FILE" 2>&1
fi

node_major=0
if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || printf 0)"
fi
if ((node_major < 20)); then
  info "Installing Node.js 20 LTS"
  curl -fsSL https://deb.nodesource.com/setup_20.x -o /tmp/reptoc-nodesource.sh
  bash /tmp/reptoc-nodesource.sh >>"$LOG_FILE" 2>&1
  rm -f /tmp/reptoc-nodesource.sh
  apt-get install -y nodejs >>"$LOG_FILE" 2>&1
fi
node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
((node_major >= 20)) || die "Node.js 20 or newer is required."

if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi

info "Copying application files to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
if [[ "$SCRIPT_DIR" != "$INSTALL_DIR" ]]; then
  rsync -a --delete \
    --exclude='.env' \
    --exclude='node_modules/' \
    --exclude='build/' \
    --exclude='dist/' \
    --exclude='uploads/' \
    --exclude='logs/' \
    --exclude='storage/' \
    "$SCRIPT_DIR/" "$INSTALL_DIR/"
fi
mkdir -p "$INSTALL_DIR/uploads" "$INSTALL_DIR/logs/admin_audit" "$INSTALL_DIR/storage/backups"

systemctl enable --now postgresql >>"$LOG_FILE" 2>&1
if [[ -z "$DATABASE_URL" ]]; then
  DB_PASSWORD="$(openssl rand -hex 16)"
  info "Creating the local PostgreSQL role and database"
  if runuser -u postgres -- psql -Atqc "SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER'" | grep -qx 1; then
    runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "ALTER ROLE \"$DB_USER\" WITH LOGIN PASSWORD '$DB_PASSWORD';" >>"$LOG_FILE"
  else
    runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "CREATE ROLE \"$DB_USER\" WITH LOGIN PASSWORD '$DB_PASSWORD';" >>"$LOG_FILE"
  fi
  if ! runuser -u postgres -- psql -Atqc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -qx 1; then
    runuser -u postgres -- createdb --owner="$DB_USER" "$DB_NAME"
  fi
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "ALTER DATABASE \"$DB_NAME\" OWNER TO \"$DB_USER\";" >>"$LOG_FILE"
  DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}"
else
  DB_PASSWORD=""
  [[ "$DATABASE_URL" == postgresql://* || "$DATABASE_URL" == postgres://* ]] || die "DATABASE_URL must be a PostgreSQL URL."
fi

JWT_SECRET="$(openssl rand -hex 48)"
ENCRYPTION_KEY="$(openssl rand -hex 32)"
IP_HASH_PEPPER="$(openssl rand -hex 32)"
public_scheme=http
[[ "$ENABLE_SSL" == 1 ]] && public_scheme=https
APP_URL="${public_scheme}://${DOMAIN}"
ALLOWED_ORIGINS="$APP_URL"
SERVER_NAME="$DOMAIN"
DISABLE_SECURE_COOKIES=false
[[ "$ENABLE_SSL" != 1 ]] && DISABLE_SECURE_COOKIES=true

dotenv_value() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

info "Writing protected environment configuration"
{
  printf 'NODE_ENV=production\nHOST=127.0.0.1\nPORT=%s\n' "$APP_PORT"
  printf 'REPTOC_ROOT=%s\nDISABLE_HMR=true\nDISABLE_VITE_MIDDLEWARE=true\nTRUSTED_PROXY_HOPS=1\n' "$(dotenv_value "$INSTALL_DIR")"
  printf 'DISABLE_SECURE_COOKIES=%s\n' "$DISABLE_SECURE_COOKIES"
  printf 'APP_URL=%s\nCORS_ORIGIN=%s\nALLOWED_ORIGINS=%s\n' "$(dotenv_value "$APP_URL")" "$(dotenv_value "$ALLOWED_ORIGINS")" "$(dotenv_value "$ALLOWED_ORIGINS")"
  printf 'DATABASE_URL=%s\n' "$(dotenv_value "$DATABASE_URL")"
  printf 'JWT_SECRET=%s\nENCRYPTION_KEY=%s\nIP_HASH_PEPPER=%s\n' "$(dotenv_value "$JWT_SECRET")" "$(dotenv_value "$ENCRYPTION_KEY")" "$(dotenv_value "$IP_HASH_PEPPER")"
  printf 'INITIAL_ADMIN_USERNAME=%s\nINITIAL_ADMIN_EMAIL=%s\nINITIAL_ADMIN_PASSWORD=%s\n' "$(dotenv_value "$ADMIN_USERNAME")" "$(dotenv_value "$ADMIN_EMAIL")" "$(dotenv_value "$ADMIN_PASSWORD")"
} >"$INSTALL_DIR/.env"
chown root:"$APP_USER" "$INSTALL_DIR/.env"
chmod 640 "$INSTALL_DIR/.env"

info "Installing Node dependencies and building Reptoc"
cd "$INSTALL_DIR"
npm ci --no-audit --no-fund >>"$LOG_FILE" 2>&1
npm run build >>"$LOG_FILE" 2>&1

info "Initializing and migrating the database"
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f postgres_schema.sql >>"$LOG_FILE" 2>&1
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f postgres_suggestion_schema.sql >>"$LOG_FILE" 2>&1
npm run db:migrate >>"$LOG_FILE" 2>&1
npm run db:migrate:status >>"$LOG_FILE" 2>&1

chown -R "$APP_USER":"$APP_USER" "$INSTALL_DIR/uploads" "$INSTALL_DIR/logs" "$INSTALL_DIR/storage"
chmod 750 "$INSTALL_DIR/uploads" "$INSTALL_DIR/logs" "$INSTALL_DIR/storage" "$INSTALL_DIR/storage/backups"

info "Installing the systemd service"
cat >/etc/systemd/system/reptoc.service <<EOF
[Unit]
Description=Reptoc Webnovel Platform
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$(command -v node) $INSTALL_DIR/build/server.cjs
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$INSTALL_DIR/uploads $INSTALL_DIR/logs $INSTALL_DIR/storage

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now reptoc >>"$LOG_FILE" 2>&1

if [[ "$ENABLE_NGINX" == 1 ]]; then
  info "Configuring Nginx"
  cat >/etc/nginx/sites-available/reptoc <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $SERVER_NAME;
    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 90s;
    }
}
EOF
  ln -sfn /etc/nginx/sites-available/reptoc /etc/nginx/sites-enabled/reptoc
  rm -f /etc/nginx/sites-enabled/default
  nginx -t >>"$LOG_FILE" 2>&1
  systemctl enable --now nginx >>"$LOG_FILE" 2>&1
  systemctl reload nginx

  if [[ "$ENABLE_SSL" == 1 ]]; then
    info "Requesting a Let's Encrypt certificate"
    apt-get install -y certbot python3-certbot-nginx >>"$LOG_FILE" 2>&1
    certbot --nginx --non-interactive --agree-tos --redirect \
      --email "$CERTBOT_EMAIL" -d "$DOMAIN" >>"$LOG_FILE" 2>&1
  fi
fi

sleep 2
if ! systemctl is-active --quiet reptoc; then
  journalctl -u reptoc -n 40 --no-pager | tee -a "$LOG_FILE" >&2
  die "The Reptoc service did not stay active."
fi
curl -fsS --max-time 15 "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null || die "The local health check failed."

ok "Installation completed successfully."
printf '\nApplication directory: %s\nService status:       systemctl status reptoc\nInstaller log:        %s\n' "$INSTALL_DIR" "$LOG_FILE"
printf 'Site URL:             %s\n' "$APP_URL"
printf 'Owner username:       %s\n' "$ADMIN_USERNAME"
if [[ "$generated_admin_password" == 1 ]]; then
  printf 'Generated password:   %s\n' "$ADMIN_PASSWORD"
  printf 'Store this password now; it will not be printed by later runs.\n'
fi
printf '\nUseful commands:\n  systemctl restart reptoc\n  journalctl -u reptoc -f\n  cd %s && npm run db:migrate\n' "$INSTALL_DIR"
