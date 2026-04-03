#!/usr/bin/env bash
# uwu-code installer
# Usage: curl -sSL https://raw.githubusercontent.com/vidwadeseram/uwu-code/main/install.sh | sudo bash
set -euo pipefail

###############################################################################
# Config defaults (override via env vars)
###############################################################################
REPO_URL="https://github.com/vidwadeseram/uwu-code.git"
INSTALL_DIR="${INSTALL_DIR:-/opt/uwu-code}"
DASHBOARD_PORT="${DASHBOARD_PORT:-3000}"
TERMINAL_PORT="${TERMINAL_PORT:-7681}"
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
echo -e "${GREEN}║                    uwu-code                          ║${NC}"
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

# LLM API keys for openclaw + regression tests
echo ""
echo -e "${BOLD}LLM API Keys (openclaw uses OpenRouter first, then Anthropic/OpenAI as fallback):${NC}"

ask "Enter your OpenRouter API key (sk-or-v1-...) or press Enter to skip:"
read -r OPENROUTER_API_KEY
OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}"

ask "Enter your Anthropic API key (sk-ant-...) or press Enter to skip:"
read -r ANTHROPIC_API_KEY
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"

ask "Enter your OpenAI API key (sk-...) or press Enter to skip:"
read -r OPENAI_API_KEY
OPENAI_API_KEY="${OPENAI_API_KEY:-}"

if [ -z "$OPENROUTER_API_KEY" ] && [ -z "$ANTHROPIC_API_KEY" ] && [ -z "$OPENAI_API_KEY" ]; then
  warn "No API keys provided — add them later via the Settings page (/settings)."
fi

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
  ca-certificates gnupg python3-pip stow \
  ffmpeg ripgrep fd-find 2>/dev/null || true

success "System packages installed."

###############################################################################
# Neovim (latest stable — LazyVim requires >= 0.9, apt version is too old)
###############################################################################
install_nvim() {
  local arch
  arch=$(uname -m)
  local tarball_candidates=""
  case "$arch" in
    x86_64)  tarball_candidates="nvim-linux-x86_64.tar.gz nvim-linux64.tar.gz" ;;
    aarch64) tarball_candidates="nvim-linux-arm64.tar.gz" ;;
    *)
      warn "Unsupported arch $arch — falling back to apt neovim"
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq neovim >/dev/null 2>&1 || true
      return
      ;;
  esac
  local latest_url
  local releases_json
  releases_json=$(curl -s https://api.github.com/repos/neovim/neovim/releases/latest)
  for tarball in $tarball_candidates; do
    latest_url=$(printf '%s' "$releases_json" \
      | grep '"browser_download_url"' \
      | grep "\"${tarball}\"" \
      | head -1 | cut -d'"' -f4 || true)
    [ -n "$latest_url" ] && break
  done
  if [ -z "$latest_url" ]; then
    warn "Could not determine Neovim download URL — falling back to apt neovim"
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq neovim >/dev/null 2>&1 || true
    return
  fi
  info "Downloading Neovim from $latest_url..."
  curl -fsSL "$latest_url" -o /tmp/nvim.tar.gz
  rm -rf /opt/nvim
  mkdir -p /opt/nvim
  tar -C /opt/nvim -xzf /tmp/nvim.tar.gz --strip-components=1
  rm /tmp/nvim.tar.gz
  ln -sf /opt/nvim/bin/nvim /usr/local/bin/nvim
}

NVIM_MIN_MAJOR=0
NVIM_MIN_MINOR=12
NVIM_MIN_PATCH=0

nvim_version_ok() {
  command -v nvim &>/dev/null || return 1
  local ver
  ver=$(nvim --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || true)
  [ -z "$ver" ] && return 1
  local maj min pat
  maj=$(echo "$ver" | cut -d. -f1)
  min=$(echo "$ver" | cut -d. -f2)
  pat=$(echo "$ver" | cut -d. -f3)
  [ "$maj" -gt "$NVIM_MIN_MAJOR" ] && return 0
  [ "$maj" -lt "$NVIM_MIN_MAJOR" ] && return 1
  [ "$min" -gt "$NVIM_MIN_MINOR" ] && return 0
  [ "$min" -lt "$NVIM_MIN_MINOR" ] && return 1
  [ "$pat" -ge "$NVIM_MIN_PATCH" ] && return 0
  return 1
}

if ! nvim_version_ok; then
  install_nvim
  if nvim_version_ok; then
    success "Neovim $(nvim --version | head -1) installed."
  elif command -v nvim &>/dev/null; then
    warn "Neovim installed but version $(nvim --version | head -1) is below required ${NVIM_MIN_MAJOR}.${NVIM_MIN_MINOR}.${NVIM_MIN_PATCH}."
  else
    warn "Neovim installation failed (command unavailable)."
  fi
else
  success "Neovim $(nvim --version | head -1) already meets minimum ${NVIM_MIN_MAJOR}.${NVIM_MIN_MINOR}.${NVIM_MIN_PATCH}."
fi

###############################################################################
# Luarocks (needed by image.nvim for the magick rock)
###############################################################################
if ! command -v luarocks &>/dev/null; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq luarocks >/dev/null 2>&1 || true
fi
if command -v luarocks &>/dev/null; then
  luarocks install magick >/dev/null 2>&1 || true
  success "Luarocks $(luarocks --version | head -1) + magick rock installed."
else
  warn "Luarocks installation failed."
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
# uwu user — Claude Code refuses --dangerously-skip-permissions as root.
# We create a non-root 'uwu' user that agents run under.
###############################################################################
info "Setting up 'uwu' agent user..."
if ! id -u uwu &>/dev/null; then
  useradd -m -s /bin/bash uwu
  success "User 'uwu' created."
else
  success "User 'uwu' already exists."
fi

###############################################################################
# Dotfiles (neovim + tmux configs from vidwadeseram/dotfiles via stow)
###############################################################################
DOTFILES_DIR="/root/.dotfiles"
if [ -d "$DOTFILES_DIR/.git" ]; then
  info "Dotfiles already cloned, pulling latest..."
  git -C "$DOTFILES_DIR" pull -q
else
  info "Cloning dotfiles..."
  git clone --depth=1 "https://github.com/vidwadeseram/dotfiles.git" "$DOTFILES_DIR" -q
fi

cd "$DOTFILES_DIR"
for pkg in nvim tmux claude opencode; do
  [ -d "$pkg" ] || continue
  stow --restow --target="/root" "$pkg" 2>/dev/null || \
    stow --target="/root" "$pkg" 2>/dev/null || true
done

mkdir -p /home/uwu/.config
for pkg in nvim tmux claude opencode; do
  [ -d "$pkg" ] || continue
  stow --restow --target="/home/uwu" "$pkg" 2>/dev/null || \
    stow --target="/home/uwu" "$pkg" 2>/dev/null || true
done
chown -R uwu:uwu /home/uwu
cd -

# Pre-bootstrap LazyVim plugins headlessly so nvim is ready on first open
info "Bootstrapping Neovim plugins (LazyVim)..."
timeout 300 nvim --headless "+Lazy! sync" +qa >/dev/null 2>&1 || \
  timeout 300 HOME=/root nvim --headless "+Lazy! sync" +qa >/dev/null 2>&1 || true
# Also bootstrap for uwu
timeout 300 sudo -u uwu HOME=/home/uwu nvim --headless "+Lazy! sync" +qa >/dev/null 2>&1 || true

success "Dotfiles applied and Neovim plugins installed."

###############################################################################
# Claude Code CLI
###############################################################################
# Claude Code CLI
###############################################################################
if ! command -v claude &>/dev/null; then
  info "Installing Claude Code..."
  npm install -g @anthropic-ai/claude-code >/dev/null 2>&1
  success "Claude Code installed."
else
  success "Claude Code already installed."
fi
# Claude binary may be installed under /root/.local which non-root users can't
# traverse. Copy the real binary to /usr/local/bin so the uwu user can run it.
CLAUDE_REAL=$(readlink -f "$(command -v claude 2>/dev/null || echo '')" 2>/dev/null || true)
if [ -f "$CLAUDE_REAL" ] && [ "$CLAUDE_REAL" != "/usr/local/bin/claude" ]; then
  install -m 755 "$CLAUDE_REAL" /usr/local/bin/claude
fi

###############################################################################
# OpenCode
###############################################################################
install_opencode_binary() {
  local candidate
  for candidate in \
    /usr/lib/node_modules/opencode-linux-x64/bin/opencode \
    /usr/lib/node_modules/opencode-linux-x64-baseline/bin/opencode \
    /usr/lib/node_modules/opencode-linux-x64-musl/bin/opencode \
    /usr/lib/node_modules/opencode-linux-x64-baseline-musl/bin/opencode \
    /usr/lib/node_modules/opencode-ai/bin/.opencode \
    /root/.opencode/bin/opencode; do
    if [ -x "$candidate" ]; then
      install -m 755 "$candidate" /usr/local/bin/opencode
      return 0
    fi
  done
  return 1
}

if ! command -v opencode &>/dev/null; then
  info "Installing OpenCode..."
  curl -fsSL https://opencode.ai/install | sh >/dev/null 2>&1 || \
    npm install -g opencode-ai >/dev/null 2>&1 || \
    npm install -g @opencode-ai/cli >/dev/null 2>&1 || \
    npm install -g @opencode-ai/opencode >/dev/null 2>&1 || true
  success "OpenCode installed (if supported on this arch)."
else
  success "OpenCode already installed."
fi

if ! opencode --version >/dev/null 2>&1; then
  npm install -g opencode-linux-x64 >/dev/null 2>&1 || true
  npm install -g opencode-linux-x64-baseline >/dev/null 2>&1 || true
  npm install -g opencode-linux-x64-musl >/dev/null 2>&1 || true
  npm install -g opencode-linux-x64-baseline-musl >/dev/null 2>&1 || true
fi

install_opencode_binary || true

if opencode --version >/dev/null 2>&1; then
  success "OpenCode $(opencode --version | head -1) ready."
else
  warn "OpenCode installed but version check failed."
fi

###############################################################################
# Allow root to sudo as uwu without a password (SSH sessions are root)
cat > /etc/sudoers.d/uwu-agents << 'SUDOEOF'
# Allow root to run commands as uwu without a password
root ALL=(uwu) NOPASSWD: ALL
SUDOEOF
chmod 440 /etc/sudoers.d/uwu-agents

# Give uwu write access to the dirs it needs
mkdir -p "$INSTALL_DIR/openclaw/data"
chmod -R a+rX "$INSTALL_DIR"
chmod -R a+w  "$INSTALL_DIR/openclaw/data"
chmod    a+rw "$INSTALL_DIR/settings.json" 2>/dev/null || true

mkdir -p /home/uwu/.config/opencode
chown -R uwu:uwu /home/uwu/.config

success "'uwu' user configured."

###############################################################################
# Clone / update repo
###############################################################################
info "Setting up $INSTALL_DIR..."
if [ -d "$INSTALL_DIR/.git" ]; then
  info "Repo exists, pulling latest..."
  git -C "$INSTALL_DIR" pull -q
else
  if [ -d "$INSTALL_DIR" ] && [ "$(ls -A "$INSTALL_DIR" 2>/dev/null | wc -l)" -gt 0 ]; then
    warn "$INSTALL_DIR exists without git metadata — resetting directory"
    rm -rf "$INSTALL_DIR"
  fi
  git clone "$REPO_URL" "$INSTALL_DIR" -q
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
# Firewall
###############################################################################
info "Configuring UFW firewall..."
ufw --force enable 2>/dev/null || true
ufw allow ssh
ufw allow 80/tcp   comment "http"
ufw allow 443/tcp  comment "https"
ufw allow "$DASHBOARD_PORT/tcp" comment "dashboard-direct"
ufw allow "$TERMINAL_PORT/tcp"  comment "ttyd-direct"
success "Firewall configured."

###############################################################################
# Systemd — dashboard
###############################################################################
info "Creating systemd services..."
AUTH_SECRET_DIR="/etc/uwu-code"
AUTH_SECRET_FILE="$AUTH_SECRET_DIR/auth_secret"
mkdir -p "$AUTH_SECRET_DIR"
if [ ! -s "$AUTH_SECRET_FILE" ]; then
  openssl rand -hex 32 > "$AUTH_SECRET_FILE"
  chmod 600 "$AUTH_SECRET_FILE"
fi
AUTH_SECRET=$(cat "$AUTH_SECRET_FILE")

cat > /etc/systemd/system/uwu-code.service << EOF
[Unit]
Description=uwu-code Dashboard
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR/dashboard
Environment=NODE_ENV=production
Environment=PORT=$DASHBOARD_PORT
Environment=AUTH_SECRET=$AUTH_SECRET
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

mkdir -p /opt/workspaces
TTYD_BIN="$(command -v ttyd || echo /usr/bin/ttyd)"
cat > /etc/systemd/system/uwu-code-ttyd.service << EOF
[Unit]
Description=uwu-code Browser Terminal (ttyd)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/workspaces
ExecStart=$TTYD_BIN --port $TERMINAL_PORT --writable /bin/bash -l
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

###############################################################################
# openclaw agent setup
###############################################################################
info "Setting up openclaw agent..."
cd "$INSTALL_DIR/openclaw"
mkdir -p data
uv sync 2>/dev/null || uv pip install anthropic openai 2>/dev/null || true

chown -R uwu:uwu "$INSTALL_DIR/openclaw" 2>/dev/null || true

cat > /etc/systemd/system/uwu-code-openclaw.service << EOF
[Unit]
Description=openclaw autonomous task agent
After=network.target uwu-code.service

[Service]
Type=simple
User=uwu
WorkingDirectory=$INSTALL_DIR/openclaw
Environment=HOME=/home/uwu
ExecStart=/usr/local/bin/python3 agent.py
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable uwu-code uwu-code-ttyd uwu-code-openclaw
systemctl restart uwu-code uwu-code-ttyd uwu-code-openclaw
success "Services started."

###############################################################################
# Nginx
###############################################################################
info "Configuring nginx..."
PUBLIC_IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null || curl -s --max-time 5 icanhazip.com 2>/dev/null || hostname -I | awk '{print $1}')

if [ -n "$DOMAIN_NAME" ]; then
  cat > /etc/nginx/sites-available/uwu-code << EOF
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

    location = /_terminal_auth_check {
        internal;
        proxy_pass http://127.0.0.1:$DASHBOARD_PORT/api/auth/check;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header Cookie \$http_cookie;
        proxy_set_header X-Original-URI \$request_uri;
    }

    location = /terminal {
        return 302 /terminal/;
    }

    location /terminal/ {
        auth_request /_terminal_auth_check;
        error_page 401 = @terminal_login;
        proxy_pass http://127.0.0.1:$TERMINAL_PORT/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 86400;
    }

    location @terminal_login {
        return 302 /login?next=/terminal/;
    }
}
EOF

  ln -sf /etc/nginx/sites-available/uwu-code /etc/nginx/sites-enabled/uwu-code
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  nginx -t && systemctl enable nginx && systemctl restart nginx

  info "Obtaining SSL certificate for ${DOMAIN_NAME}..."
  certbot --nginx -d "$DOMAIN_NAME" \
    --non-interactive --agree-tos \
    --email "$SSL_EMAIL" \
    --redirect 2>&1 | grep -E "Successfully|error|Error" || true

  DASHBOARD_URL="https://${DOMAIN_NAME}"
  TERMINAL_URL="https://${DOMAIN_NAME}/terminal/"

else
  cat > /etc/nginx/sites-available/uwu-code << EOF
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

    location = /_terminal_auth_check {
        internal;
        proxy_pass http://127.0.0.1:$DASHBOARD_PORT/api/auth/check;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header Cookie \$http_cookie;
        proxy_set_header X-Original-URI \$request_uri;
    }

    location = /terminal {
        return 302 /terminal/;
    }

    location /terminal/ {
        auth_request /_terminal_auth_check;
        error_page 401 = @terminal_login;
        proxy_pass http://127.0.0.1:$TERMINAL_PORT/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 86400;
    }

    location @terminal_login {
        return 302 /login?next=/terminal/;
    }
}
EOF
  ln -sf /etc/nginx/sites-available/uwu-code /etc/nginx/sites-enabled/uwu-code
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  nginx -t && systemctl enable nginx && systemctl restart nginx
  DASHBOARD_URL="http://${PUBLIC_IP}"
  TERMINAL_URL="http://${PUBLIC_IP}/terminal/"
fi

success "Nginx configured."

###############################################################################
# Done
###############################################################################
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║          uwu-code — Installation Complete            ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Dashboard:  ${CYAN}${DASHBOARD_URL}${NC}"
  echo -e "  Terminal:   ${CYAN}${TERMINAL_URL}${NC}"
  echo -e "  Scheduler:  ${CYAN}${DASHBOARD_URL}/scheduler${NC}"
echo -e "  OpenClaw:   ${CYAN}${DASHBOARD_URL}/openclaw${NC}"
echo ""
echo -e "  Manage:"
echo -e "    ${YELLOW}systemctl status uwu-code uwu-code-openclaw${NC}"
echo ""
echo -e "  Update:"
echo -e "    ${YELLOW}cd $INSTALL_DIR && git pull && cd dashboard && npm ci && npm run build && systemctl restart uwu-code${NC}"
echo ""
