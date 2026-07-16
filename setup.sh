#!/usr/bin/env bash

set -Eeuo pipefail

APP_NAME="clipsave"
APP_USER="clipsave"
APP_DIR="/opt/clipsave"
APP_PORT="5173"
ENV_FILE="/etc/clipsave.env"
APP_ENV_FILE="${APP_DIR}/.env"
NGINX_FILE="/etc/nginx/sites-available/${APP_NAME}"
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

info() {
  printf '\n\033[1;34m==> %s\033[0m\n' "$1"
}

fail() {
  printf '\n\033[1;31mLỗi: %s\033[0m\n' "$1" >&2
  exit 1
}

on_error() {
  local exit_code="$?"
  printf '\n\033[1;31mLỗi tại dòng %s (mã %s): %s\033[0m\n' "$1" "${exit_code}" "$2" >&2
  exit "${exit_code}"
}

trap 'on_error "${LINENO}" "${BASH_COMMAND}"' ERR

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
  fi
fi

# Kiểm tra trước khi cài dependency/build để Certbot không thất bại ở bước cuối.
if ! getent ahosts "${DOMAIN}" >/dev/null 2>&1; then
  fail "${DOMAIN} chưa có bản ghi DNS A/AAAA hợp lệ. Hãy cấu hình DNS, đợi cập nhật rồi chạy lại."
fi

if [[ -n "${WWW_DOMAIN}" ]] && ! getent ahosts "${WWW_DOMAIN}" >/dev/null 2>&1; then
  fail "${WWW_DOMAIN} chưa có DNS. Hãy tạo CNAME 'www' → '${DOMAIN}' (hoặc A/AAAA về VPS); nếu không dùng www, chạy lại và chọn N."
fi

info "Cài Nginx, Certbot và công cụ hệ thống"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg nginx certbot python3-certbot-nginx rsync openssl

NODE_SUPPORTED=0
if command -v node >/dev/null 2>&1; then
  NODE_SUPPORTED="$(node -p "const [major, minor] = process.versions.node.split('.').map(Number); Number((major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 24)" 2>/dev/null || printf '0')"
fi

if (( NODE_SUPPORTED == 0 )); then
  info "Cài Node.js 22 LTS"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes --output /etc/apt/keyrings/nodesource.gpg
  printf 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main\n' \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
fi

NODE_SUPPORTED="$(node -p "const [major, minor] = process.versions.node.split('.').map(Number); Number((major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 24)")"
if (( NODE_SUPPORTED == 0 )); then
  fail "Vite 8 cần Node.js 20.19+ hoặc 22.12+, phiên bản hiện tại: $(node --version)"
fi
NODE_BIN="$(readlink -f "$(command -v node)")"

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

# runuser giữ nguyên working directory của root. PM2 sẽ báo
# "spawn /usr/bin/node EACCES" nếu source nằm trong /root, vì daemon không thể
# truy cập working directory đó. Luôn chuyển sang APP_DIR trước khi hạ quyền.
run_as_app() {
  (
    # ERR trap được kế thừa vào subshell với `set -E`; tắt bản sao này để một
    # lỗi chỉ được báo một lần ở lệnh gọi run_as_app.
    trap - ERR
    cd "${APP_DIR}"
    runuser -u "${APP_USER}" -- env \
      HOME="${APP_DIR}" \
      PM2_HOME="${APP_DIR}/.pm2" \
      "$@"
  )
}

umask 077
touch "${ENV_FILE}"
if ! grep -q '^MEDIA_PROXY_SECRET=' "${ENV_FILE}"; then
  printf 'MEDIA_PROXY_SECRET=%s\n' "$(openssl rand -hex 32)" >> "${ENV_FILE}"
fi
if ! grep -q '^CLIENT_SIGNATURE_KEY=' "${ENV_FILE}"; then
  printf 'CLIENT_SIGNATURE_KEY=%s\n' "$(openssl rand -hex 24)" >> "${ENV_FILE}"
fi
# Root quản lý nội dung; group clipsave chỉ được đọc để server có thể load .env.
chown root:"${APP_USER}" "${ENV_FILE}"
chmod 640 "${ENV_FILE}"

if [[ -e "${APP_ENV_FILE}" && ! -L "${APP_ENV_FILE}" ]]; then
  fail "${APP_ENV_FILE} đã tồn tại và không phải symlink. Hãy sao lưu/xóa file này rồi chạy lại để tránh ghi đè secret ngoài ý muốn."
fi
ln -sfn "${ENV_FILE}" "${APP_ENV_FILE}"
chown -h root:"${APP_USER}" "${APP_ENV_FILE}"
umask 022

MEDIA_PROXY_SECRET="$(sed -n 's/^MEDIA_PROXY_SECRET=//p' "${ENV_FILE}" | head -n 1)"
CLIENT_SIGNATURE_KEY="$(sed -n 's/^CLIENT_SIGNATURE_KEY=//p' "${ENV_FILE}" | head -n 1)"
if [[ -z "${MEDIA_PROXY_SECRET}" || -z "${CLIENT_SIGNATURE_KEY}" ]]; then
  fail "Không thể khởi tạo secret trong ${ENV_FILE}."
fi

info "Cài dependency và build production"
run_as_app npm ci --no-audit --no-fund
run_as_app env \
  CLIENT_SIGNATURE_KEY="${CLIENT_SIGNATURE_KEY}" \
  npm run build

if ! run_as_app "${NODE_BIN}" --version >/dev/null; then
  fail "User ${APP_USER} không có quyền chạy ${NODE_BIN}. Kiểm tra quyền bằng: namei -l ${NODE_BIN}"
fi

NPM_BIN="$(command -v npm)"
info "Cài đặt và khởi động ứng dụng bằng PM2"
umask 022
npm install --global pm2 --no-audit --no-fund
PM2_BIN="$(command -v pm2)"

# Một bản PM2 từng được cài khi umask=077 có thể chỉ đọc được bởi root. Chỉ cài
# lại khi user ứng dụng thật sự không chạy được PM2, tránh gỡ/cài lại mỗi deploy.
if ! run_as_app "${PM2_BIN}" --version >/dev/null 2>&1; then
  info "Sửa quyền bản cài PM2 global"
  npm uninstall --global pm2 || true
  npm install --global pm2 --no-audit --no-fund
  PM2_BIN="$(command -v pm2)"
  run_as_app "${PM2_BIN}" --version >/dev/null
fi

# Dọn service systemd cũ nếu VPS từng chạy phiên bản setup trước.
if [[ -f "/etc/systemd/system/${APP_NAME}.service" ]]; then
  systemctl disable --now "${APP_NAME}.service" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/${APP_NAME}.service"
  systemctl daemon-reload
fi

if run_as_app "${PM2_BIN}" describe "${APP_NAME}" >/dev/null 2>&1; then
  run_as_app env \
    NODE_ENV=production \
    PORT="${APP_PORT}" \
    MEDIA_PROXY_SECRET="${MEDIA_PROXY_SECRET}" \
    CLIENT_SIGNATURE_KEY="${CLIENT_SIGNATURE_KEY}" \
    "${PM2_BIN}" restart "${APP_NAME}" --update-env --max-memory-restart 400M
else
  run_as_app env \
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

run_as_app "${PM2_BIN}" save
env PATH="${PATH}" PM2_HOME="${APP_DIR}/.pm2" \
  "${PM2_BIN}" startup systemd -u "${APP_USER}" --hp "${APP_DIR}"

# Cài pm2-logrotate để log không phình vô hạn
if ! run_as_app "${PM2_BIN}" describe pm2-logrotate >/dev/null 2>&1; then
  run_as_app "${PM2_BIN}" install pm2-logrotate || true
  run_as_app "${PM2_BIN}" save
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
  run_as_app "${PM2_BIN}" status || true
  run_as_app "${PM2_BIN}" logs "${APP_NAME}" --lines 50 --nostream || true
  fail "Ứng dụng không khởi động tại port ${APP_PORT}."
fi

CERTBOT_DOMAINS=(-d "${DOMAIN}")
if [[ -n "${WWW_DOMAIN}" ]]; then
  CERTBOT_DOMAINS+=(-d "${WWW_DOMAIN}")
fi

# ── Redirect non-www → www (tránh duplicate content cho SEO) ─────────────────
PRIMARY_DOMAIN="${DOMAIN}"
if [[ -n "${WWW_DOMAIN}" ]]; then
  PRIMARY_DOMAIN="${WWW_DOMAIN}"
fi

info "Cấu hình Nginx cho ${DOMAIN}${WWW_DOMAIN:+ và ${WWW_DOMAIN}}"
NGINX_BACKUP=""
if [[ -f "${NGINX_FILE}" ]]; then
  NGINX_BACKUP="$(mktemp)"
  cp -a "${NGINX_FILE}" "${NGINX_BACKUP}"
fi

cat > "${NGINX_FILE}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${PRIMARY_DOMAIN};

    # Đặt gzip trong server block để không trùng directive gzip toàn cục của VPS.
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
        proxy_hide_header Cache-Control;
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

# Chỉ domain chính được proxy. Domain không có www chuyển hướng riêng để tránh
# hai server block cùng khai báo một server_name khiến Nginx bỏ qua redirect.
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
if ! nginx -t; then
  if [[ -n "${NGINX_BACKUP}" ]]; then
    cp -a "${NGINX_BACKUP}" "${NGINX_FILE}"
  else
    rm -f "${NGINX_FILE}" "/etc/nginx/sites-enabled/${APP_NAME}"
  fi
  if [[ -n "${NGINX_BACKUP}" ]]; then
    rm -f "${NGINX_BACKUP}"
  fi
  nginx -t || true
  fail "Cấu hình Nginx mới không hợp lệ; đã khôi phục cấu hình trước đó."
fi
if [[ -n "${NGINX_BACKUP}" ]]; then
  rm -f "${NGINX_BACKUP}"
fi
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
printf 'File môi trường: %s -> %s\n' "${APP_ENV_FILE}" "${ENV_FILE}"
printf 'Xem log ứng dụng: sudo -u %s HOME=%s pm2 logs %s\n' "${APP_USER}" "${APP_DIR}" "${APP_NAME}"
printf 'Cập nhật lần sau: chạy lại sudo bash setup.sh từ thư mục source.\n'
