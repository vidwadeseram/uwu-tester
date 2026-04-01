#!/usr/bin/env bash
# uwu-code installer
# Usage: curl -sSL https://raw.githubusercontent.com/vidwadeseram/uwu-code/main/install.sh | sudo bash
set -euo pipefail

###############################################################################
# Config defaults (override via env vars)
###############################################################################
REPO_URL="https://github.com/vidwadeseram/uwu-code.git"
INSTALL_DIR="${INSTALL_DIR:-/opt/vps-dashboard}"
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
  local tarball
  case "$arch" in
    x86_64)  tarball="nvim-linux-x86_64.tar.gz" ;;
    aarch64) tarball="nvim-linux-arm64.tar.gz"   ;;
    *)       warn "Unsupported arch $arch — skipping neovim install"; return ;;
  esac
  local latest_url
  latest_url=$(curl -s https://api.github.com/repos/neovim/neovim/releases/latest \
    | grep '"browser_download_url"' \
    | grep "\"${tarball}\"" \
    | head -1 | cut -d'"' -f4)
  if [ -z "$latest_url" ]; then
    warn "Could not determine Neovim download URL — skipping"
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

if ! nvim --version 2>/dev/null | head -1 | grep -qE 'v0\.(9|1[0-9])'; then
  install_nvim
  success "Neovim $(/usr/local/bin/nvim --version | head -1) installed."
else
  success "Neovim $(nvim --version | head -1) already up to date."
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

# Stow nvim + tmux for root (the ttyd terminal runs as root)
cd "$DOTFILES_DIR"
for pkg in nvim tmux; do
  [ -d "$pkg" ] || continue
  stow --restow --target="/root" "$pkg" 2>/dev/null || \
    stow --target="/root" "$pkg" 2>/dev/null || true
done

# Stow nvim + tmux for uwu (agent user)
mkdir -p /home/uwu/.config
for pkg in nvim tmux; do
  [ -d "$pkg" ] || continue
  stow --restow --target="/home/uwu" "$pkg" 2>/dev/null || \
    stow --target="/home/uwu" "$pkg" 2>/dev/null || true
done
chown -R uwu:uwu /home/uwu/.config
cd -

# Pre-bootstrap LazyVim plugins headlessly so nvim is ready on first open
info "Bootstrapping Neovim plugins (LazyVim)..."
nvim --headless "+Lazy! sync" +qa 2>/dev/null || \
  HOME=/root nvim --headless "+Lazy! sync" +qa 2>/dev/null || true
# Also bootstrap for uwu
sudo -u uwu HOME=/home/uwu nvim --headless "+Lazy! sync" +qa 2>/dev/null || true

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
if ! command -v opencode &>/dev/null; then
  info "Installing OpenCode..."
  curl -fsSL https://opencode.ai/install | sh >/dev/null 2>&1 || \
    npm install -g opencode-ai >/dev/null 2>&1 || true
  success "OpenCode installed (if supported on this arch)."
else
  success "OpenCode already installed."
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

# Allow root to sudo as uwu without a password (SSH sessions are root)
cat > /etc/sudoers.d/uwu-agents << 'SUDOEOF'
# Allow root to run commands as uwu without a password
root ALL=(uwu) NOPASSWD: ALL
SUDOEOF
chmod 440 /etc/sudoers.d/uwu-agents

# Give uwu write access to the dirs it needs
# (regression_tests for running/reading tests; workspaces for project files)
mkdir -p "$INSTALL_DIR/regression_tests/results"
mkdir -p "$INSTALL_DIR/openclaw/data"
chmod -R a+rX "$INSTALL_DIR"
chmod -R a+w  "$INSTALL_DIR/regression_tests/results"
chmod -R a+w  "$INSTALL_DIR/regression_tests/test_cases"
chmod -R a+w  "$INSTALL_DIR/openclaw/data"
chmod    a+rw "$INSTALL_DIR/settings.json" 2>/dev/null || true

mkdir -p /home/uwu/.config/opencode
cat > /home/uwu/.config/opencode/config.json << OPENCODEMCP
{
  "permission": "allow",
  "mcp": {
    "uwu-code": {
      "type": "local",
      "command": ["/usr/local/bin/uwu-mcp"],
      "enabled": true
    }
  }
}
OPENCODEMCP
chown -R uwu:uwu /home/uwu/.config

success "'uwu' user configured."

###############################################################################
# uv (Python package manager for regression tests)
###############################################################################
if ! command -v uv &>/dev/null; then
  info "Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.cargo/bin:$PATH"
  success "uv installed."
else
  success "uv $(uv --version 2>/dev/null | head -1) already installed."
fi

# Make uv accessible to non-root uwu user (uv symlinks to /root/.local/bin)
# Copy the real binary so uwu can execute it, then create a wrapper
if [ -f "$HOME/.local/bin/uv" ] && [ ! -f /usr/local/bin/uv.real ]; then
  cp "$HOME/.local/bin/uv" /usr/local/bin/uv.real
  chmod 755 /usr/local/bin/uv.real
fi
if [ ! -f /usr/local/bin/uv ]; then
  ln -s /usr/local/bin/uv.real /usr/local/bin/uv 2>/dev/null || true
fi

# Wrapper script that lets uwu (or any user) run uv without sudo permission issues
if [ ! -f /usr/local/bin/uv-uwu ]; then
  cat > /usr/local/bin/uv-uwu << 'UVUWUSCRIPT'
#!/bin/bash
exec /usr/local/bin/uv.real "$@"
UVUWUSCRIPT
  chmod 755 /usr/local/bin/uv-uwu
fi

# uvx = uv tool run; newer browser-use calls uvx directly
if [ ! -f /usr/local/bin/uvx ]; then
  cat > /usr/local/bin/uvx << 'UVXSCRIPT'
#!/bin/bash
exec /usr/local/bin/uv tool run "$@"
UVXSCRIPT
  chmod 755 /usr/local/bin/uvx
fi

# uwu-mcp: fast wrapper for the MCP server (bypasses uv run startup overhead)
# Claude Code uses this wrapper; it must run from the regression_tests dir so
# pydantic_settings finds the .env there (not from /root which uwu can't access).
cat > /usr/local/bin/uwu-mcp << UWUMCPSCRIPT
#!/bin/bash
cd $INSTALL_DIR/regression_tests
exec $INSTALL_DIR/regression_tests/.venv/bin/python mcp_server.py
UWUMCPSCRIPT
chmod 755 /usr/local/bin/uwu-mcp

# Register the MCP server in uwu's claude config (project: /home/uwu)
# so 'cd /home/uwu && claude ...' can find it without extra setup.
sudo -u uwu bash -c 'cd /home/uwu && claude mcp remove uwu-code 2>/dev/null; claude mcp add uwu-code -- /usr/local/bin/uwu-mcp' || true

###############################################################################
# Clone / update repo
###############################################################################
info "Setting up $INSTALL_DIR..."
if [ -d "$INSTALL_DIR/.git" ]; then
  info "Repo exists, pulling latest..."
  git -C "$INSTALL_DIR" pull -q
else
  git clone "$REPO_URL" "$INSTALL_DIR" -q
fi
success "Repo ready."

###############################################################################
# Install browser-use dependencies
###############################################################################
info "Installing browser-use regression test dependencies..."
cd "$INSTALL_DIR/regression_tests"
uv sync 2>/dev/null || uv pip install browser-use langchain-anthropic 2>/dev/null || true

# Install Playwright browsers
uv run playwright install chromium 2>/dev/null || true
success "browser-use ready."

###############################################################################
# Write .env for regression tests
###############################################################################
ENV_FILE="$INSTALL_DIR/regression_tests/.env"
touch "$ENV_FILE"

set_env() {
  local key="$1" val="$2" file="$3"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=\"${val}\"|" "$file"
  else
    echo "${key}=\"${val}\"" >> "$file"
  fi
}

[ -n "$OPENROUTER_API_KEY" ] && set_env "OPENROUTER_API_KEY" "$OPENROUTER_API_KEY" "$ENV_FILE"
[ -n "$ANTHROPIC_API_KEY" ]  && set_env "ANTHROPIC_API_KEY"  "$ANTHROPIC_API_KEY"  "$ENV_FILE"
[ -n "$OPENAI_API_KEY" ]     && set_env "OPENAI_API_KEY"     "$OPENAI_API_KEY"     "$ENV_FILE"

success "Regression test environment configured."

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
cat > /etc/systemd/system/vps-dashboard.service << EOF
[Unit]
Description=uwu-code
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

mkdir -p /opt/workspaces
cat > /etc/systemd/system/vps-ttyd.service << EOF
[Unit]
Description=uwu-code Browser Terminal (ttyd)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/workspaces
ExecStart=/usr/local/bin/ttyd --port $TERMINAL_PORT --writable bash -c 'cd /opt/workspaces && exec bash'
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

# Hand .venv and data ownership to uwu so it can write when running as that user
chown -R uwu:uwu "$INSTALL_DIR/openclaw/.venv" 2>/dev/null || true
chown -R uwu:uwu "$INSTALL_DIR/openclaw/data"  2>/dev/null || true

# Same for regression_tests .venv — uwu runs test_runner.py via uv
chown -R uwu:uwu "$INSTALL_DIR/regression_tests/.venv" 2>/dev/null || true

cat > /etc/systemd/system/vps-openclaw.service << EOF
[Unit]
Description=openclaw autonomous task agent
After=network.target vps-dashboard.service

[Service]
Type=simple
User=uwu
WorkingDirectory=$INSTALL_DIR/openclaw
Environment=HOME=/home/uwu
EnvironmentFile=-$INSTALL_DIR/regression_tests/.env
ExecStart=/usr/local/bin/uv-uwu run agent.py
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable vps-dashboard vps-ttyd vps-openclaw
systemctl restart vps-dashboard vps-ttyd vps-openclaw
success "Services started."

###############################################################################
# Nginx
###############################################################################
info "Configuring nginx..."
PUBLIC_IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null || curl -s --max-time 5 icanhazip.com 2>/dev/null || hostname -I | awk '{print $1}')

if [ -n "$DOMAIN_NAME" ]; then
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

  DASHBOARD_URL="https://${DOMAIN_NAME}"
  TERMINAL_URL="https://${DOMAIN_NAME}/terminal/"

else
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
}
EOF
  ln -sf /etc/nginx/sites-available/vps-dashboard /etc/nginx/sites-enabled/vps-dashboard
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
echo -e "  Tests:      ${CYAN}${DASHBOARD_URL}/tests${NC}"
echo -e "  Scheduler:  ${CYAN}${DASHBOARD_URL}/scheduler${NC}"
echo -e "  OpenClaw:   ${CYAN}${DASHBOARD_URL}/openclaw${NC}"
echo ""
echo -e "  Manage:"
echo -e "    ${YELLOW}systemctl status vps-dashboard vps-openclaw${NC}"
echo ""
echo -e "  Update:"
echo -e "    ${YELLOW}cd $INSTALL_DIR && git pull && cd dashboard && npm ci && npm run build && systemctl restart vps-dashboard${NC}"
echo ""
