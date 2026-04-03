# uwu-code

A web-based VPS development dashboard with an autonomous AI task agent and real-time server monitoring.

## Features

| Page | What it does |
|---|---|
| **Dashboard** `/` | System stats, tmux sessions, port tracker, expose ports, projects panel |
| **Scheduler** `/scheduler` | Queue coding and research tasks for openclaw to work on autonomously |
| **OpenClaw** `/openclaw` | Live monitor for the openclaw agent — status, current task, activity log |
| **Settings** `/settings` | Manage API keys and set a login password for the dashboard |
| **Terminal** `/terminal/` | Full browser terminal (ttyd) with `/opt/workspaces` as default directory |

### Dashboard panels

- **Tmux Sessions** — all sessions and windows with CWD, PID, matched ports, and per-window **Expose Port** buttons
- **Ports** — every listening port with process name, PID, and one-click expose to public
- **Projects** — git repos under `/opt/workspaces`, clone new repos inline
- **Core** — systemd services and Docker containers

### openclaw — autonomous AI agent

openclaw runs as a background daemon, picks up tasks from the Scheduler, and completes them using:

- **Coding tasks** → runs `opencode` (then falls back to `claude --print`) inside the chosen workspace
- **Research tasks** → calls OpenRouter → Anthropic → OpenAI API directly
- **Rate limiting** → auto-detects quota errors and reschedules the task 1 hour forward
- Full report generated for every completed task, viewable in the Scheduler completed tab

## Install

Run on your VPS as root:

```bash
curl -sSL https://raw.githubusercontent.com/vidwadeseram/uwu-code/main/install.sh | sudo bash
```

The installer prompts for:
- **Domain name** (optional) — configures nginx + Let's Encrypt SSL automatically
- **OpenRouter API key** — used by openclaw for all AI tasks (recommended)
- **Anthropic / OpenAI API keys** — fallback providers (optional)

What gets installed:

| Component | Details |
|---|---|
| Node.js 20 | Dashboard runtime |
| ttyd | Browser terminal |
| nginx | Reverse proxy + optional SSL |
| tmux + neovim | Terminal tools |
| openclaw agent | Autonomous AI task daemon |
| Claude Code CLI | `claude` — used by openclaw for coding tasks |
| OpenCode | `opencode` — alternative coding tool |
| Dotfiles | Configs from `vidwadeseram/dotfiles` via stow |

### Systemd services

| Service | Description |
|---|---|
| `uwu-code` | Next.js dashboard on port 3000 |
| `uwu-code-ttyd` | Browser terminal on port 7681 |
| `uwu-code-openclaw` | openclaw autonomous agent |

```bash
systemctl status uwu-code uwu-code-ttyd uwu-code-openclaw
```

### File layout on VPS

```
/opt/uwu-code/        ← repo root
  dashboard/               ← Next.js app
  openclaw/
    agent.py               ← autonomous task daemon
    data/
      tasks.json           ← task queue (read/written by scheduler + agent)
      status.json          ← current agent state
      agent.log            ← rolling activity log
  settings.json            ← dashboard login credentials (optional)

/opt/workspaces/           ← your git repos (untouched by reinstalls)
```

## Updating

```bash
cd /opt/uwu-code && git pull && cd dashboard && npm ci && npm run build
systemctl restart uwu-code uwu-code-openclaw
```

## Scheduler

Tasks created in `/scheduler`. Supported types:

- **Research** — openclaw answers using the LLM API directly (OpenRouter preferred)
- **Coding** — openclaw runs `opencode` or `claude --print` in the selected workspace

Tool preference per coding task: **Auto** (tries opencode → claude), **Claude Code**, or **OpenCode**.

## Settings

Visit `/settings` to:
- Add or rotate API keys (saved to `settings.json`, picked up by openclaw on next task)
- Set a username + password to protect the dashboard behind a login page

Credentials are stored in `/opt/uwu-code/settings.json`. Sessions last 30 days.
