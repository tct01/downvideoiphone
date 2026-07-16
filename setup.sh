#!/usr/bin/env bash

set -Eeuo pipefail

APP_NAME="clipsave"
APP_USER="clipsave"
APP_DIR="/opt/clipsave"
APP_PORT="5173"
ENV_FILE="/etc/clipsave.env"
NGINX_FILE="/etc/nginx/sites-available/${APP_NAME}"
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

info() {
  printf '\n\033[1;34m==> %s\033[0m\n' "$1"
}

fail() {
  printf '\n\033[1;31mLỗi: %s\033[0m\n' "$1" >&2
  exit 1
}

if [[ "${EUID}" -ne 0 ]]; then
  fail "Hãy chạy script bằng quyền root: sudo bash setup.sh"
fi

if [[ ! -f /etc/os-release ]]; then
  fail "Không xác định được hệ điều hành. Script chỉ hỗ trợ Ubuntu/Debian."
fi

if [[ ! -f "${SOURCE_DIR}/package.json" || ! -f "${SOURCE_DIR}/package-lock.json" ]]; then
  fail "Hãy đặt setup.sh trong thư mục gốc của project ClipSave."
fi

# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "ubuntu" && "${ID:-}" != "debian" && "${ID_LIKE:-}" != *"debian"* ]]; then
  fail "Hệ điều hành ${PRETTY_NAME:-này} chưa được hỗ trợ. Chỉ dùng Ubuntu/Debian."
fi

printf 'Domain phải trỏ A/AAAA về VPS trước khi cấp SSL.\n'
read -r -p "Domain (ví dụ: clipsave.example.com): " DOMAIN
read -r -p "Email nhận thông báo SSL: " EMAIL

DOMAIN="${DOMAIN,,}"
DOMAIN="${DOMAIN%.}"

if [[ ! "${DOMAIN}" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]; then
  fail "Domain không hợp lệ. Chỉ nhập hostname, không nhập https:// hoặc đường dẫn."
fi

if [[ ! "${EMAIL}" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  fail "Email không hợp lệ."
fi

WWW_DOMAIN=""
if [[ "${DOMAIN}" != www.* ]]; then
  read -r -p "Cấu hình thêm www.${DOMAIN}? [y/N]: " ADD_WWW
  if [[ "${ADD_WWW,,}" == "y" || "${ADD_WWW,,}" == "yes" ]]; then
    WWW_DOMAIN="www.${DOMAIN}"
    printf 'Đảm bảo %s cũng đã trỏ về VPS.\n' "${WWW_DOMAIN}"
  fi
fi

info "Cài Nginx, Certbot và công cụ hệ thống"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg nginx certbot python3-certbot-nginx rsync openssl

NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || printf '0')"
fi

if (( NODE_MAJOR < 20 )); then
  info "Cài Node.js 22 LTS"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes --output /etc/apt/keyrings/nodesource.gpg
  printf 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main\n' \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
fi

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if (( NODE_MAJOR < 20 )); then
  fail "Cần Node.js 20 trở lên, phiên bản hiện tại: $(node --version)"
fi

# ── Swap 2 GB (tránh OOM khi build trên VPS RAM thấp) ────────────────────────
if ! swapon --show | grep -q '/swapfile'; then
  info "Tạo swap 2 GB"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
  sysctl -w vm.swappiness=10 >/dev/null
  grep -q '^vm.swappiness' /etc/sysctl.conf || printf 'vm.swappiness=10\n' >> /etc/sysctl.conf
fi

info "Chuẩn bị ứng dụng tại ${APP_DIR}"
if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${APP_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
fi
install -d -o "${APP_USER}" -g "${APP_USER}" "${APP_DIR}"

if [[ "$(realpath "${SOURCE_DIR}")" != "$(realpath "${APP_DIR}")" ]]; then
  rsync -a --delete \
    --exclude='.git/' \
    --exclude='node_modules/' \
    --exclude='dist/' \
    --exclude='.npm/' \
    --exclude='.pm2/' \
    --exclude='.env' \
    --exclude='.env.*' \
    "${SOURCE_DIR}/" "${APP_DIR}/"
fi

chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

umask 077
touch "${ENV_FILE}"
if ! grep -q '^MEDIA_PROXY_SECRET=' "${ENV_FILE}"; then
  printf 'MEDIA_PROXY_SECRET=%s\n' "$(openssl rand -hex 32)" >> "${ENV_FILE}"
fi
if ! grep -q '^CLIENT_SIGNATURE_KEY=' "${ENV_FILE}"; then
  printf 'CLIENT_SIGNATURE_KEY=%s\n' "$(openssl rand -hex 24)" >> "${ENV_FILE}"
fi
chown root:root "${ENV_FILE}"
chmod 600 "${ENV_FILE}"

MEDIA_PROXY_SECRET="$(sed -n 's/^MEDIA_PROXY_SECRET=//p' "${ENV_FILE}" | head -n 1)"
CLIENT_SIGNATURE_KEY="$(sed -n 's/^CLIENT_SIGNATURE_KEY=//p' "${ENV_FILE}" | head -n 1)"
if [[ -z "${MEDIA_PROXY_SECRET}" || -z "${CLIENT_SIGNATURE_KEY}" ]]; then
  fail "Không thể khởi tạo secret trong ${ENV_FILE}."
fi

info "Cài dependency và build production"
runuser -u "${APP_USER}" -- env HOME="${APP_DIR}" npm --prefix "${APP_DIR}" ci
runuser -u "${APP_USER}" -- env \
  HOME="${APP_DIR}" \
  CLIENT_SIGNATURE_KEY="${CLIENT_SIGNATURE_KEY}" \
  npm --prefix "${APP_DIR}" run build

NPM_BIN="$(command -v npm)"
info "Cài đặt và khởi động ứng dụng bằng PM2"
npm install --global pm2
PM2_BIN="$(command -v pm2)"

# Dọn service systemd cũ nếu VPS từng chạy phiên bản setup trước.
if [[ -f "/etc/systemd/system/${APP_NAME}.service" ]]; then
  systemctl disable --now "${APP_NAME}.service" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/${APP_NAME}.service"
  systemctl daemon-reload
fi

if runuser -u "${APP_USER}" -- env HOME="${APP_DIR}" "${PM2_BIN}" describe "${APP_NAME}" >/dev/null 2>&1; then
  runuser -u "${APP_USER}" -- env \
    HOME="${APP_DIR}" \
    NODE_ENV=production \
    PORT="${APP_PORT}" \
    MEDIA_PROXY_SECRET="${MEDIA_PROXY_SECRET}" \
    CLIENT_SIGNATURE_KEY="${CLIENT_SIGNATURE_KEY}" \
    "${PM2_BIN}" restart "${APP_NAME}" --update-env --max-memory-restart 400M
else
  runuser -u "${APP_USER}" -- env \
    HOME="${APP_DIR}" \
    NODE_ENV=production \
    PORT="${APP_PORT}" \
    MEDIA_PROXY_SECRET="${MEDIA_PROXY_SECRET}" \
    CLIENT_SIGNATURE_KEY="${CLIENT_SIGNATURE_KEY}" \
    "${PM2_BIN}" start "${NPM_BIN}" \
      --name "${APP_NAME}" \
      --cwd "${APP_DIR}" \
      --max-memory-restart 400M \
      -- start
fi

runuser -u "${APP_USER}" -- env HOME="${APP_DIR}" "${PM2_BIN}" save
"${PM2_BIN}" startup systemd -u "${APP_USER}" --hp "${APP_DIR}"

# Cài pm2-logrotate để log không phình vô hạn
if ! runuser -u "${APP_USER}" -- env HOME="${APP_DIR}" "${PM2_BIN}" describe pm2-logrotate >/dev/null 2>&1; then
  runuser -u "${APP_USER}" -- env HOME="${APP_DIR}" "${PM2_BIN}" install pm2-logrotate || true
fi

APP_READY=0
for _ in {1..20}; do
  if curl -fsS "http://127.0.0.1:${APP_PORT}/" >/dev/null; then
    APP_READY=1
    break
  fi
  sleep 1
done

if (( APP_READY == 0 )); then
  runuser -u "${APP_USER}" -- env HOME="${APP_DIR}" "${PM2_BIN}" status || true
  runuser -u "${APP_USER}" -- env HOME="${APP_DIR}" "${PM2_BIN}" logs "${APP_NAME}" --lines 50 --nostream || true
  fail "Ứng dụng không khởi động tại port ${APP_PORT}."
fi

SERVER_NAMES="${DOMAIN}"
CERTBOT_DOMAINS=(-d "${DOMAIN}")
if [[ -n "${WWW_DOMAIN}" ]]; then
  SERVER_NAMES+=" ${WWW_DOMAIN}"
  CERTBOT_DOMAINS+=(-d "${WWW_DOMAIN}")
fi

# ── Redirect non-www → www (tránh duplicate content cho SEO) ─────────────────
PRIMARY_DOMAIN="${DOMAIN}"
if [[ -n "${WWW_DOMAIN}" ]]; then
  PRIMARY_DOMAIN="${WWW_DOMAIN}"
fi

info "Cấu hình Nginx cho ${SERVER_NAMES}"
cat > "${NGINX_FILE}" <<EOF
# Gzip compression
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_min_length 256;
gzip_comp_level 5;
gzip_types
    text/plain
    text/css
    text/javascript
    application/json
    application/javascript
    application/xml
    application/manifest+json
    image/svg+xml;

server {
    listen 80;
    listen [::]:80;
    server_name ${SERVER_NAMES};

    client_max_body_size 2m;
    large_client_header_buffers 4 16k;

    # Security headers
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    # Service Worker — không cache để PWA luôn cập nhật
    location = /sw.js {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        add_header Cache-Control "public, max-age=0, must-revalidate" always;
        add_header X-Content-Type-Options "nosniff" always;
    }

    location /api/media {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Range \$http_range;
        proxy_set_header If-Range \$http_if_range;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 310s;
        proxy_send_timeout 310s;
    }

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Connection "";
        proxy_read_timeout 75s;
    }
}
EOF

# Thêm redirect block non-www → www nếu user chọn cấu hình www
if [[ -n "${WWW_DOMAIN}" ]]; then
  cat >> "${NGINX_FILE}" <<EOF

# Redirect non-www → www (SEO: tránh duplicate content)
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    return 301 https://${WWW_DOMAIN}\$request_uri;
}
EOF
fi

ln -sfn "${NGINX_FILE}" "/etc/nginx/sites-enabled/${APP_NAME}"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
  ufw allow 'Nginx Full'
fi

info "Cấp chứng chỉ SSL Let's Encrypt"
certbot --nginx \
  --non-interactive \
  --agree-tos \
  --redirect \
  --email "${EMAIL}" \
  "${CERTBOT_DOMAINS[@]}"

if systemctl list-unit-files --type=timer 2>/dev/null | grep -q '^certbot.timer'; then
  systemctl enable --now certbot.timer
fi

nginx -t
systemctl reload nginx

printf '\n\033[1;32mDeploy hoàn tất: https://%s\033[0m\n' "${DOMAIN}"
printf 'Xem log ứng dụng: sudo -u %s HOME=%s pm2 logs %s\n' "${APP_USER}" "${APP_DIR}" "${APP_NAME}"
printf 'Cập nhật lần sau: chạy lại sudo bash setup.sh từ thư mục source.\n'
