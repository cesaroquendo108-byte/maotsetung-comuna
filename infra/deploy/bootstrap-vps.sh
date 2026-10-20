#!/usr/bin/env bash
set -euo pipefail

PB_VERSION="0.39.8"
PB_HOME="/opt/maotsetung/pocketbase"
PB_URL="http://172.17.0.1:8095"
PUBLIC_URL="https://pb-maotsetung.157.173.104.214.nip.io"
STAGE_DIR="/tmp/maotsetung-deploy"
SECRETS_FILE="/etc/maotsetung/bootstrap.env"
PB_RUNTIME_ENV="/etc/maotsetung/pocketbase.env"
PB_SERVICE="maotsetung-pocketbase.service"
service_was_active=0

restore_service_on_failure() {
  local status=$?
  if [[ "$status" -ne 0 && "$service_was_active" -eq 1 ]]; then
    systemctl start "$PB_SERVICE" >/dev/null 2>&1 || true
  fi
  return "$status"
}
trap restore_service_on_failure EXIT

if [[ "$(id -u)" != "0" ]]; then
  echo "Este script debe ejecutarse como root." >&2
  exit 1
fi

if ! id maotsetung >/dev/null 2>&1; then
  useradd --system --home-dir /opt/maotsetung --shell /usr/sbin/nologin maotsetung
fi

install -d -o root -g root -m 0755 /opt/maotsetung
install -d -o maotsetung -g maotsetung -m 0750 "$PB_HOME" "$PB_HOME/pb_data"
install -d -o root -g root -m 0700 /etc/maotsetung

if [[ ! -f "$PB_RUNTIME_ENV" ]]; then
  if [[ -s "$PB_HOME/pb_data/data.db" ]]; then
    echo "Falta el archivo de cifrado de una base existente; se rechazo generar otra clave para evitar perder acceso a secretos." >&2
    exit 1
  fi
  umask 077
  printf 'PB_ENCRYPTION_KEY=%s\n' "$(openssl rand -hex 16)" > "$PB_RUNTIME_ENV"
fi
chown root:root "$PB_RUNTIME_ENV"
chmod 0600 "$PB_RUNTIME_ENV"
PB_ENCRYPTION_KEY="$(awk -F= '$1 == "PB_ENCRYPTION_KEY" { print substr($0, index($0, "=") + 1) }' "$PB_RUNTIME_ENV")"
if [[ ! "$PB_ENCRYPTION_KEY" =~ ^[0-9a-f]{32}$ ]]; then
  echo "La clave de cifrado de PocketBase debe ser hexadecimal y tener exactamente 32 caracteres." >&2
  exit 1
fi
export PB_ENCRYPTION_KEY

if [[ -f "/opt/uroprofin/pocketbase/pocketbase" ]]; then
  cp -a /opt/uroprofin/pocketbase/pocketbase "$PB_HOME/pocketbase"
  chmod 0755 "$PB_HOME/pocketbase"
else
  archive="pocketbase_${PB_VERSION}_linux_amd64.zip"
  curl --fail --location --silent --show-error \
    "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/${archive}" \
    --output "/tmp/${archive}"
  unzip -p "/tmp/${archive}" pocketbase > "$PB_HOME/pocketbase"
  rm -f "/tmp/${archive}"
  chmod 0755 "$PB_HOME/pocketbase"
fi

if systemctl is-active --quiet "$PB_SERVICE"; then
  systemctl stop "$PB_SERVICE"
  service_was_active=1
fi

install -d -o root -g maotsetung -m 0750 "$PB_HOME/pb_migrations" "$PB_HOME/pb_hooks" "$PB_HOME/pb_hooks/lib"
cp -a "$STAGE_DIR/infra/pocketbase/pb_migrations/." "$PB_HOME/pb_migrations/"
cp -a "$STAGE_DIR/infra/pocketbase/pb_hooks/." "$PB_HOME/pb_hooks/"
chown -R root:maotsetung "$PB_HOME/pb_migrations" "$PB_HOME/pb_hooks"
find "$PB_HOME/pb_migrations" "$PB_HOME/pb_hooks" -type d -exec chmod 0750 {} +
find "$PB_HOME/pb_migrations" "$PB_HOME/pb_hooks" -type f -exec chmod 0640 {} +

if [[ ! -f "$SECRETS_FILE" ]]; then
  umask 077
  super_password="$(openssl rand -hex 24)"
  service_password="$(openssl rand -hex 24)"
  payments_password="$(openssl rand -hex 24)"
  cne_password="$(openssl rand -hex 24)"
  app_admin_password="$(openssl rand -hex 24)"
  import_hmac="$(openssl rand -hex 48)"
  {
    printf 'PB_SUPERUSER_EMAIL=%q\n' 'admin@maotsetung.invalid'
    printf 'PB_SUPERUSER_PASSWORD=%q\n' "$super_password"
    printf 'MAOTSETUNG_SERVICE_EMAIL=%q\n' 'service@maotsetung.invalid'
    printf 'MAOTSETUNG_SERVICE_PASSWORD=%q\n' "$service_password"
    printf 'MAOTSETUNG_PAYMENTS_EMAIL=%q\n' 'payments@maotsetung.invalid'
    printf 'MAOTSETUNG_PAYMENTS_PASSWORD=%q\n' "$payments_password"
    printf 'MAOTSETUNG_CNE_EMAIL=%q\n' 'cne@maotsetung.invalid'
    printf 'MAOTSETUNG_CNE_PASSWORD=%q\n' "$cne_password"
    printf 'MAOTSETUNG_APP_ADMIN_EMAIL=%q\n' 'admin-app@maotsetung.invalid'
    printf 'MAOTSETUNG_APP_ADMIN_PASSWORD=%q\n' "$app_admin_password"
    printf 'MAOTSETUNG_IMPORT_HMAC_KEY=%q\n' "$import_hmac"
  } > "$SECRETS_FILE"
fi

chmod 0600 "$SECRETS_FILE"
# shellcheck disable=SC1090
source "$SECRETS_FILE"
export PB_SUPERUSER_EMAIL PB_SUPERUSER_PASSWORD MAOTSETUNG_SERVICE_EMAIL MAOTSETUNG_SERVICE_PASSWORD MAOTSETUNG_PAYMENTS_EMAIL MAOTSETUNG_PAYMENTS_PASSWORD MAOTSETUNG_CNE_EMAIL MAOTSETUNG_CNE_PASSWORD MAOTSETUNG_APP_ADMIN_EMAIL MAOTSETUNG_APP_ADMIN_PASSWORD MAOTSETUNG_IMPORT_HMAC_KEY

runuser -u maotsetung -- "$PB_HOME/pocketbase" migrate up \
  --dir="$PB_HOME/pb_data" \
  --migrationsDir="$PB_HOME/pb_migrations" \
  --hooksDir="$PB_HOME/pb_hooks" \
  --encryptionEnv=PB_ENCRYPTION_KEY

runuser -u maotsetung -- "$PB_HOME/pocketbase" superuser upsert "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD" \
  --dir="$PB_HOME/pb_data" \
  --migrationsDir="$PB_HOME/pb_migrations" \
  --hooksDir="$PB_HOME/pb_hooks" \
  --encryptionEnv=PB_ENCRYPTION_KEY

install -o root -g root -m 0644 "$STAGE_DIR/infra/systemd/maotsetung-pocketbase.service" /etc/systemd/system/maotsetung-pocketbase.service
systemctl daemon-reload
systemctl enable "$PB_SERVICE"
systemctl restart "$PB_SERVICE"
service_was_active=0

for _ in $(seq 1 25); do
  if curl --fail --silent "$PB_URL/api/health" >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent "$PB_URL/api/health" >/dev/null

super_token="$(curl --fail --silent --show-error \
  --request POST "$PB_URL/api/collections/_superusers/auth-with-password" \
  --header 'Content-Type: application/json' \
  --data "$(python3 -c 'import json,os; print(json.dumps({"identity":os.environ["PB_SUPERUSER_EMAIL"],"password":os.environ["PB_SUPERUSER_PASSWORD"]}))')" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')"

pb_api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  if [[ -n "$data" ]]; then
    curl --fail --silent --show-error --request "$method" "$PB_URL$path" \
      --header "Authorization: Bearer $super_token" \
      --header 'Content-Type: application/json' \
      --data "$data"
  else
    curl --fail --silent --show-error --request "$method" "$PB_URL$path" \
      --header "Authorization: Bearer $super_token"
  fi
}

service_payload="$(MAOTSETUNG_SERVICE_EMAIL="$MAOTSETUNG_SERVICE_EMAIL" MAOTSETUNG_SERVICE_PASSWORD="$MAOTSETUNG_SERVICE_PASSWORD" python3 -c 'import json,os; print(json.dumps({"email":os.environ["MAOTSETUNG_SERVICE_EMAIL"],"password":os.environ["MAOTSETUNG_SERVICE_PASSWORD"],"passwordConfirm":os.environ["MAOTSETUNG_SERVICE_PASSWORD"],"name":"Importacion Mao Tse Tung","verified":True,"serviceAccount":True,"serviceScopes":["import"],"disabled":False}))')"
payments_payload="$(MAOTSETUNG_PAYMENTS_EMAIL="$MAOTSETUNG_PAYMENTS_EMAIL" MAOTSETUNG_PAYMENTS_PASSWORD="$MAOTSETUNG_PAYMENTS_PASSWORD" python3 -c 'import json,os; print(json.dumps({"email":os.environ["MAOTSETUNG_PAYMENTS_EMAIL"],"password":os.environ["MAOTSETUNG_PAYMENTS_PASSWORD"],"passwordConfirm":os.environ["MAOTSETUNG_PAYMENTS_PASSWORD"],"name":"Pagos Mao Tse Tung","verified":True,"serviceAccount":True,"serviceScopes":["payments"],"disabled":False}))')"
cne_payload="$(MAOTSETUNG_CNE_EMAIL="$MAOTSETUNG_CNE_EMAIL" MAOTSETUNG_CNE_PASSWORD="$MAOTSETUNG_CNE_PASSWORD" python3 -c 'import json,os; print(json.dumps({"email":os.environ["MAOTSETUNG_CNE_EMAIL"],"password":os.environ["MAOTSETUNG_CNE_PASSWORD"],"passwordConfirm":os.environ["MAOTSETUNG_CNE_PASSWORD"],"name":"CNE Mao Tse Tung","verified":True,"serviceAccount":True,"serviceScopes":["cne"],"disabled":False}))')"
app_admin_payload="$(MAOTSETUNG_APP_ADMIN_EMAIL="$MAOTSETUNG_APP_ADMIN_EMAIL" MAOTSETUNG_APP_ADMIN_PASSWORD="$MAOTSETUNG_APP_ADMIN_PASSWORD" python3 -c 'import json,os; print(json.dumps({"email":os.environ["MAOTSETUNG_APP_ADMIN_EMAIL"],"password":os.environ["MAOTSETUNG_APP_ADMIN_PASSWORD"],"passwordConfirm":os.environ["MAOTSETUNG_APP_ADMIN_PASSWORD"],"name":"Administracion Mao Tse Tung","verified":True,"serviceAccount":False,"disabled":False}))')"

ensure_service_account() {
  local email="$1"
  local payload="$2"
  local filter
  local account_id
  filter="$(SERVICE_EMAIL="$email" python3 -c 'import os,urllib.parse; print(urllib.parse.quote("email = \""+os.environ["SERVICE_EMAIL"]+"\""))')"
  account_id="$(pb_api GET "/api/collections/users/records?perPage=1&filter=$filter" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["items"][0]["id"] if d["items"] else "")')"
  if [[ -z "$account_id" ]]; then
    pb_api POST /api/collections/users/records "$payload" >/dev/null
  else
    pb_api PATCH "/api/collections/users/records/$account_id" "$payload" >/dev/null
  fi
}

ensure_service_account "$MAOTSETUNG_SERVICE_EMAIL" "$service_payload"
ensure_service_account "$MAOTSETUNG_PAYMENTS_EMAIL" "$payments_payload"
ensure_service_account "$MAOTSETUNG_CNE_EMAIL" "$cne_payload"

app_admin_id="$(pb_api GET "/api/collections/users/records?perPage=1&filter=$(python3 -c 'import urllib.parse,os; print(urllib.parse.quote("email = \""+os.environ["MAOTSETUNG_APP_ADMIN_EMAIL"]+"\""))')" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["items"][0]["id"] if d["items"] else "")')"
if [[ -z "$app_admin_id" ]]; then
  app_admin_id="$(pb_api POST /api/collections/users/records "$app_admin_payload" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
fi

commune_id="$(pb_api GET '/api/collections/communes/records?perPage=1&filter=code%20%3D%20%22MTT-001%22' | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["items"][0]["id"] if d["items"] else "")')"
if [[ -z "$commune_id" ]]; then
  commune_id="$(pb_api POST /api/collections/communes/records '{"code":"MTT-001","name":"Comuna Mao Tse Tung","legalName":"Comuna Socialista Mao Tse Tung","state":"Distrito Capital","municipality":"Municipio Bolivariano Libertador","parish":"San Agustin","status":"active"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
fi

membership_filter="$(APP_ADMIN_ID="$app_admin_id" COMMUNE_ID="$commune_id" python3 -c 'import os,urllib.parse; print(urllib.parse.quote("user = \""+os.environ["APP_ADMIN_ID"]+"\" && community = \""+os.environ["COMMUNE_ID"]+"\""))')"
membership_id="$(pb_api GET "/api/collections/community_memberships/records?perPage=1&filter=$membership_filter" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["items"][0]["id"] if d["items"] else "")')"
if [[ -z "$membership_id" ]]; then
  membership_payload="$(APP_ADMIN_ID="$app_admin_id" COMMUNE_ID="$commune_id" python3 -c 'import json,os; print(json.dumps({"user":os.environ["APP_ADMIN_ID"],"community":os.environ["COMMUNE_ID"],"role":"admin","status":"active","approvedAt":"2026-10-19 00:00:00.000Z","notes":"Cuenta tecnica inicial de Comuna Mao Tse Tung."}))')"
  pb_api POST /api/collections/community_memberships/records "$membership_payload" >/dev/null
fi

settings_payload="$(PUBLIC_URL="$PUBLIC_URL" python3 -c 'import json,os; print(json.dumps({"meta":{"appName":"Comuna Mao Tse Tung","appURL":os.environ["PUBLIC_URL"],"senderName":"Comuna Mao Tse Tung","senderAddress":"no-reply@maotsetung.invalid"},"backups":{"cron":"0 3 * * *","cronMaxKeep":7},"rateLimits":{"enabled":True,"rules":[{"label":"*:auth","audience":"","duration":60,"maxRequests":10},{"label":"*:create","audience":"","duration":10,"maxRequests":500},{"label":"/api/","audience":"","duration":10,"maxRequests":1000}]},"trustedProxy":{"headers":["X-Forwarded-For"],"useLeftmostIP":True},"logs":{"maxDays":30,"logIP":False,"logAuthId":True}}))')"
pb_api PATCH /api/settings "$settings_payload" >/dev/null

caddy_file="/root/Caddyfile.ana-bvc"
if ! grep -q '^pb-maotsetung\.157\.173\.104\.214\.nip\.io' "$caddy_file"; then
  backup="${caddy_file}.before-maotsetung-$(date +%Y%m%d%H%M%S)"
  cp -a "$caddy_file" "$backup"
  printf '\n' >> "$caddy_file"
  cat "$STAGE_DIR/infra/caddy/maotsetung.Caddyfile" >> "$caddy_file"
  if ! docker exec caddy caddy validate --config /etc/caddy/Caddyfile >/dev/null; then
    cp -a "$backup" "$caddy_file"
    echo "La configuracion de Caddy no fue valida; se restauro el archivo anterior." >&2
    exit 1
  fi
  docker exec caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null
fi

for _ in $(seq 1 30); do
  if curl --fail --silent "$PUBLIC_URL/api/health" >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent "$PUBLIC_URL/api/health" >/dev/null

echo "Comuna Mao Tse Tung PocketBase desplegado y saludable en $PUBLIC_URL"
echo "Credenciales guardadas con modo 0600 en $SECRETS_FILE"
