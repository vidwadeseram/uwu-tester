#!/usr/bin/env bash
# uwu-tester - VPS Dev Dashboard installer
# Usage: curl -sSL https://raw.githubusercontent.com/vidwadeseram/uwu-tester/main/install.sh | bash
set -euo pipefail

###############################################################################
# Config defaults (override via env vars)
###############################################################################
REPO_URL="https://github.com/vidwadeseram/uwu-tester.git"
INSTALL_DIR="${INSTALL_DIR:-/opt/vps-dashboard}"
DASHBOARD_PORT="${DASHBOARD_PORT:-3000}"
TERMINAL_PORT="${TERMINAL_PORT:-7681}"
SKYVERN_API_PORT="${SKYVERN_API_PORT:-8000}"
SKYVERN_UI_PORT="${SKYVERN_UI_PORT:-8080}"
SKYVERN_UI_HTTPS_PORT="${SKYVERN_UI_HTTPS_PORT:-8443}"
NODE_VERSION="20"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
ask()     { echo -e "${BOLD}$*${NC}"; }

require_root() { [ "$EUID" -eq 0 ] || error "Please run as root: sudo bash install.sh"; }
require_root

###############################################################################
# Interactive setup
###############################################################################
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           uwu-tester VPS Dev Dashboard               ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# Domain
ask "Enter your domain name (e.g. code.example.com) or press Enter to use IP only:"
read -r DOMAIN_NAME
DOMAIN_NAME="${DOMAIN_NAME:-}"

# Email for Let's Encrypt (only if domain provided)
if [ -n "$DOMAIN_NAME" ]; then
  ask "Enter your email for SSL certificate (Let's Encrypt):"
  read -r SSL_EMAIL
  SSL_EMAIL="${SSL_EMAIL:-admin@${DOMAIN_NAME}}"
fi

# LLM Provider selection
echo ""
echo -e "${BOLD}Select LLM provider for Skyvern:${NC}"
echo "  1) OpenRouter  (supports 300+ models, recommended)"
echo "  2) OpenAI"
echo "  3) Anthropic"
echo "  4) Gemini"
echo "  5) Skip (configure manually later)"
ask "Enter choice [1-5] (default: 1):"
read -r LLM_CHOICE
LLM_CHOICE="${LLM_CHOICE:-1}"

LLM_KEY=""
SECONDARY_LLM_KEY=""
OPENROUTER_API_KEY=""
OPENAI_API_KEY=""
ANTHROPIC_API_KEY=""
GEMINI_API_KEY=""
ENABLE_OPENAI="false"
ENABLE_ANTHROPIC="false"
ENABLE_GEMINI="false"

case "$LLM_CHOICE" in
  1)
    ask "Enter your OpenRouter API key (sk-or-v1-...):"
    read -r OPENROUTER_API_KEY
    echo ""
    echo -e "${BOLD}Select model (or enter custom openrouter/<provider>/<model>):${NC}"
    echo "  1) minimax/minimax-m2.7          (MiniMax M2.7 — fast & capable)"
    echo "  2) anthropic/claude-sonnet-4-5   (Claude Sonnet 4.5)"
    echo "  3) openai/gpt-4o                 (GPT-4o)"
    echo "  4) google/gemini-2.5-pro         (Gemini 2.5 Pro)"
    echo "  5) Custom model"
    ask "Enter choice [1-5] (default: 1):"
    read -r MODEL_CHOICE
    MODEL_CHOICE="${MODEL_CHOICE:-1}"
    case "$MODEL_CHOICE" in
      1) LLM_KEY="openrouter/minimax/minimax-m2.7" ;;
      2) LLM_KEY="openrouter/anthropic/claude-sonnet-4-5" ;;
      3) LLM_KEY="openrouter/openai/gpt-4o" ;;
      4) LLM_KEY="openrouter/google/gemini-2.5-pro" ;;
      5) ask "Enter full model key (e.g. openrouter/provider/model-name):"; read -r LLM_KEY ;;
      *) LLM_KEY="openrouter/minimax/minimax-m2.7" ;;
    esac
    SECONDARY_LLM_KEY="$LLM_KEY"
    ;;
  2)
    ENABLE_OPENAI="true"
    ask "Enter your OpenAI API key:"
    read -r OPENAI_API_KEY
    LLM_KEY="OPENAI_GPT4V"
    SECONDARY_LLM_KEY="OPENAI_GPT4V"
    ;;
  3)
    ENABLE_ANTHROPIC="true"
    ask "Enter your Anthropic API key:"
    read -r ANTHROPIC_API_KEY
    LLM_KEY="ANTHROPIC_CLAUDE4_SONNET"
    SECONDARY_LLM_KEY="ANTHROPIC_CLAUDE4_SONNET"
    ;;
  4)
    ENABLE_GEMINI="true"
    ask "Enter your Gemini API key:"
    read -r GEMINI_API_KEY
    LLM_KEY="GEMINI_FLASH_2_0_EXP"
    SECONDARY_LLM_KEY="GEMINI_FLASH_2_0_EXP"
    ;;
  5)
    warn "Skipping LLM setup — edit /opt/vps-dashboard/skyvern/.env manually."
    ;;
esac

echo ""
info "Starting installation..."
echo ""

###############################################################################
# Detect OS
###############################################################################
info "Detecting OS..."
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_ID="$ID"
else
  error "Cannot detect OS. Only Ubuntu/Debian supported."
fi
case "$OS_ID" in
  ubuntu|debian|linuxmint) PKG_MGR="apt-get" ;;
  *) error "Unsupported OS: $OS_ID. Only Ubuntu/Debian supported." ;;
esac
info "OS: $OS_ID"

###############################################################################
# System packages
###############################################################################
info "Updating package lists..."
apt-get update -qq

info "Installing system dependencies..."
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  curl wget git tmux build-essential \
  ufw net-tools iproute2 \
  nginx certbot python3-certbot-nginx \
  cmake libjson-c-dev libwebsockets-dev \
  ca-certificates gnupg 2>/dev/null || true

success "System packages installed."

###############################################################################
# Docker
###############################################################################
if ! command -v docker &>/dev/null; then
  info "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  success "Docker $(docker --version | cut -d' ' -f3 | tr -d ',') installed."
else
  success "Docker already installed."
fi

###############################################################################
# Node.js
###############################################################################
if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt "$NODE_VERSION" ]]; then
  info "Installing Node.js $NODE_VERSION..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash - >/dev/null 2>&1
  apt-get install -y nodejs >/dev/null 2>&1
  success "Node.js $(node -v) installed."
else
  success "Node.js $(node -v) already installed."
fi

###############################################################################
# ttyd (browser terminal)
###############################################################################
if ! command -v ttyd &>/dev/null; then
  info "Installing ttyd..."
  TTYD_VER=$(curl -s https://api.github.com/repos/tsl0922/ttyd/releases/latest | grep '"tag_name"' | cut -d'"' -f4)
  ARCH=$(uname -m); [ "$ARCH" = "aarch64" ] || ARCH="x86_64"
  curl -fsSL "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VER}/ttyd.${ARCH}" -o /usr/local/bin/ttyd
  chmod +x /usr/local/bin/ttyd
  success "ttyd ${TTYD_VER} installed."
else
  success "ttyd already installed."
fi

###############################################################################
# Clone / update repo
###############################################################################
info "Setting up $INSTALL_DIR..."
if [ -d "$INSTALL_DIR/.git" ]; then
  info "Repo exists, pulling latest..."
  git -C "$INSTALL_DIR" pull --recurse-submodules -q
else
  git clone --recurse-submodules "$REPO_URL" "$INSTALL_DIR" -q
fi
success "Repo ready."

###############################################################################
# Dashboard build
###############################################################################
info "Installing dashboard dependencies..."
cd "$INSTALL_DIR/dashboard"
npm ci --prefer-offline --loglevel=error 2>/dev/null || npm install --loglevel=error
info "Building dashboard..."
npm run build >/dev/null 2>&1
success "Dashboard built."

###############################################################################
# Skyvern LLM + browser configuration
###############################################################################
info "Configuring Skyvern..."
cd "$INSTALL_DIR/skyvern"

# Create backend .env from example if needed
[ -f .env ] || cp .env.example .env 2>/dev/null || cp env.litellm.example .env 2>/dev/null || touch .env

set_env() {
  local key="$1" val="$2" file=".env"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=\"${val}\"|" "$file"
  else
    echo "${key}=\"${val}\"" >> "$file"
  fi
}

[ -n "$LLM_KEY" ]             && set_env "LLM_KEY" "$LLM_KEY"
[ -n "$SECONDARY_LLM_KEY" ]   && set_env "SECONDARY_LLM_KEY" "$SECONDARY_LLM_KEY"
[ -n "$OPENROUTER_API_KEY" ]  && set_env "OPENROUTER_API_KEY" "$OPENROUTER_API_KEY"
[ -n "$OPENAI_API_KEY" ]      && set_env "OPENAI_API_KEY" "$OPENAI_API_KEY"
[ -n "$ANTHROPIC_API_KEY" ]   && set_env "ANTHROPIC_API_KEY" "$ANTHROPIC_API_KEY"
[ -n "$GEMINI_API_KEY" ]      && set_env "GEMINI_API_KEY" "$GEMINI_API_KEY"
set_env "ENABLE_OPENAI"     "$ENABLE_OPENAI"
set_env "ENABLE_ANTHROPIC"  "$ENABLE_ANTHROPIC"
set_env "ENABLE_GEMINI"     "$ENABLE_GEMINI"
set_env "BROWSER_TYPE"      "chromium-headful"
set_env "BROWSER_STREAMING_MODE" "vnc"

# Determine base URL for frontend
if [ -n "$DOMAIN_NAME" ]; then
  BASE_URL="https://${DOMAIN_NAME}"
  WSS_URL="wss://${DOMAIN_NAME}"
else
  PUBLIC_IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null || curl -s --max-time 5 icanhazip.com 2>/dev/null || hostname -I | awk '{print $1}')
  BASE_URL="http://${PUBLIC_IP}"
  WSS_URL="ws://${PUBLIC_IP}"
fi

cat > skyvern-frontend/.env << EOF
VITE_BROWSER_STREAMING_MODE=vnc
VITE_API_BASE_URL=${BASE_URL}/skyvern-api/api/v1
VITE_ARTIFACT_API_BASE_URL=${BASE_URL}/skyvern-api
VITE_WSS_BASE_URL=${WSS_URL}/skyvern-api/api/v1
VITE_SKYVERN_API_KEY=skyvern-api-key
VITE_ENABLE_LOG_ARTIFACTS=false
VITE_ENABLE_CODE_BLOCK=true
VITE_ENABLE_2FA_NOTIFICATIONS=true
EOF

success "Skyvern configured."

###############################################################################
# Start Skyvern
###############################################################################
info "Starting Skyvern containers..."
cd "$INSTALL_DIR/skyvern"
docker compose pull -q 2>/dev/null || true
docker compose up -d 2>/dev/null || true
sleep 10

# Get the generated API key and update frontend .env
SKYVERN_KEY=$(docker compose logs skyvern 2>/dev/null | grep '"cred"' | grep -o '"cred"="[^"]*"' | cut -d'"' -f4 | tail -1)
if [ -n "$SKYVERN_KEY" ]; then
  sed -i "s|VITE_SKYVERN_API_KEY=.*|VITE_SKYVERN_API_KEY=${SKYVERN_KEY}|" skyvern-frontend/.env
  docker compose restart skyvern-ui >/dev/null 2>&1 || true
  info "Skyvern API key injected into frontend."
fi

success "Skyvern started."

###############################################################################
# Firewall
###############################################################################
info "Configuring UFW firewall..."
ufw --force enable 2>/dev/null || true
ufw allow ssh
ufw allow 80/tcp    comment "http"
ufw allow 443/tcp   comment "https"
ufw allow "$DASHBOARD_PORT/tcp" comment "dashboard-direct"
ufw allow "$TERMINAL_PORT/tcp"  comment "ttyd-direct"
ufw allow "$SKYVERN_UI_HTTPS_PORT/tcp" comment "skyvern-ui-https"
ufw allow "$SKYVERN_API_PORT/tcp" comment "skyvern-api-direct"
success "Firewall configured."

###############################################################################
# Systemd — dashboard
###############################################################################
info "Creating systemd services..."
cat > /etc/systemd/system/vps-dashboard.service << EOF
[Unit]
Description=VPS Dev Dashboard (uwu-tester)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR/dashboard
Environment=NODE_ENV=production
Environment=PORT=$DASHBOARD_PORT
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/vps-ttyd.service << EOF
[Unit]
Description=VPS Browser Terminal (ttyd)
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/ttyd --port $TERMINAL_PORT --writable /bin/bash
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable vps-dashboard vps-ttyd
systemctl restart vps-dashboard vps-ttyd
success "Services started."

###############################################################################
# Nginx
###############################################################################
info "Configuring nginx..."
PUBLIC_IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null || curl -s --max-time 5 icanhazip.com 2>/dev/null || hostname -I | awk '{print $1}')

if [ -n "$DOMAIN_NAME" ]; then
  # HTTPS with Let's Encrypt — write HTTP config first, certbot will upgrade
  cat > /etc/nginx/sites-available/vps-dashboard << EOF
server {
    listen 80;
    server_name ${DOMAIN_NAME};

    location / {
        proxy_pass http://127.0.0.1:$DASHBOARD_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }

    location /terminal/ {
        proxy_pass http://127.0.0.1:$TERMINAL_PORT/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 86400;
    }

    location /skyvern-api/ {
        proxy_pass http://127.0.0.1:$SKYVERN_API_PORT/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300;
    }

    location /skyvern-vnc/ {
        proxy_pass http://127.0.0.1:6080/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 86400;
    }
}
EOF

  ln -sf /etc/nginx/sites-available/vps-dashboard /etc/nginx/sites-enabled/vps-dashboard
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  nginx -t && systemctl enable nginx && systemctl restart nginx

  info "Obtaining SSL certificate for ${DOMAIN_NAME}..."
  certbot --nginx -d "$DOMAIN_NAME" \
    --non-interactive --agree-tos \
    --email "$SSL_EMAIL" \
    --redirect 2>&1 | grep -E "Successfully|error|Error" || true

  # Add Skyvern UI HTTPS block (port 8443)
  cat >> /etc/nginx/sites-available/vps-dashboard << EOF

# Skyvern UI — HTTPS on port 8443
server {
    listen $SKYVERN_UI_HTTPS_PORT ssl;
    server_name ${DOMAIN_NAME};

    ssl_certificate     /etc/letsencrypt/live/${DOMAIN_NAME}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN_NAME}/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        proxy_pass http://127.0.0.1:$SKYVERN_UI_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_read_timeout 300;
    }
}
EOF
  nginx -t && systemctl reload nginx
  SKYVERN_URL="https://${DOMAIN_NAME}:${SKYVERN_UI_HTTPS_PORT}"
  DASHBOARD_URL="https://${DOMAIN_NAME}"
  TERMINAL_URL="https://${DOMAIN_NAME}/terminal/"

else
  # No domain — plain HTTP
  cat > /etc/nginx/sites-available/vps-dashboard << EOF
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:$DASHBOARD_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
    }

    location /terminal/ {
        proxy_pass http://127.0.0.1:$TERMINAL_PORT/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 86400;
    }

    location /skyvern-api/ {
        proxy_pass http://127.0.0.1:$SKYVERN_API_PORT/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_read_timeout 300;
    }

    location /skyvern-vnc/ {
        proxy_pass http://127.0.0.1:6080/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 86400;
    }
}
EOF
  ln -sf /etc/nginx/sites-available/vps-dashboard /etc/nginx/sites-enabled/vps-dashboard
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  nginx -t && systemctl enable nginx && systemctl restart nginx
  SKYVERN_URL="http://${PUBLIC_IP}:${SKYVERN_UI_PORT}"
  DASHBOARD_URL="http://${PUBLIC_IP}"
  TERMINAL_URL="http://${PUBLIC_IP}/terminal/"
fi

success "Nginx configured."

###############################################################################
# Done
###############################################################################
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         uwu-tester — Installation Complete           ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Dashboard:  ${CYAN}${DASHBOARD_URL}${NC}"
echo -e "  Terminal:   ${CYAN}${TERMINAL_URL}${NC}"
echo -e "  Skyvern UI: ${CYAN}${SKYVERN_URL}${NC}"
echo -e "  LLM:        ${CYAN}${LLM_KEY:-not configured}${NC}"
echo ""
echo -e "  Manage:"
echo -e "    ${YELLOW}systemctl status vps-dashboard${NC}"
echo -e "    ${YELLOW}cd /opt/vps-dashboard/skyvern && docker compose ps${NC}"
echo ""
echo -e "  Update: ${YELLOW}cd $INSTALL_DIR && git pull --recurse-submodules && cd dashboard && npm ci && npm run build && systemctl restart vps-dashboard${NC}"
echo ""
