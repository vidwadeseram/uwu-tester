

<img width="227" height="191" alt="Screenshot 2026-04-05 at 8 28 40 AM" src="https://github.com/user-attachments/assets/2facf58d-f90d-4936-80e1-5e6ee3fb329b" />

# uwu-code

A web-based VPS development dashboard with an autonomous AI task agent and real-time server monitoring.

## Features

| Page | What it does |
|---|---|
| **Dashboard** `/` | System stats, tmux sessions, port tracker, expose ports, projects panel |
| **Scheduler** `/scheduler` | Queue coding and research tasks — live activity feed with user intervention |
| **OpenClaw** `/openclaw` | Live monitor for the openclaw agent — status, current task, activity log |
| **Settings** `/settings` | Manage API keys, model selection, and set a login password |
| **Terminal** `/terminal/` | Full browser terminal (ttyd) with `/opt/workspaces` as default directory |

### Dashboard panels

- **Tmux Sessions** — all sessions and windows with CWD, PID, matched ports, and per-window **Expose Port** buttons
- **Ports** — every listening port with process name, PID, and one-click expose to public
- **Projects** — git repos under `/opt/workspaces`, clone new repos inline
- **Core** — systemd services and Docker containers

### OpenCode Server integration

Coding tasks run through **OpenCode Server** (`opencode serve`) — an HTTP API that provides:

- **Live activity feed** — running task cards show tool calls, AI messages, file diffs in real time
- **User intervention** — send messages to running sessions, abort tasks, approve permissions
- **Session management** — one OpenCode server per workspace, detached from the dashboard process
- **Auto-reconnect** — dashboard reconnects to existing OpenCode servers after restart

### openclaw — autonomous AI agent

openclaw runs as a background daemon, picks up tasks from the Scheduler, and completes them using:

- **Coding tasks** → spawns an OpenCode Server session via the dashboard API
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
| Bun | Fast JS runtime for building |
| ttyd | Browser terminal |
| nginx | Reverse proxy + optional SSL |
| tmux + neovim | Terminal tools |
| openclaw agent | Autonomous AI task daemon |
| OpenCode | AI coding tool — runs via `opencode serve` HTTP API |
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
    src/lib/opencode-server.ts  ← OpenCode Server manager
    src/app/api/opencode/       ← Server API proxy routes
  openclaw/
    agent.py               ← autonomous task daemon
    data/
      tasks.json           ← task queue (read/written by scheduler + agent)
      status.json          ← current agent state
      agent.log            ← rolling activity log
  settings.json            ← dashboard login credentials (optional)

/opt/workspaces/           ← your git repos (untouched by reinstalls)
```

### Architecture

```
Scheduler UI  →  Dashboard API  →  OpenCode Server (opencode serve)
                     ↓                      ↓
              openclaw agent          AI coding session
              (task daemon)           (tool calls, edits, etc.)
```

OpenCode servers run as detached processes and survive dashboard restarts. The dashboard auto-reconnects on startup.

## Updating

```bash
cd /opt/uwu-code && git pull && cd dashboard && bun install --frozen-lockfile && bun run build
systemctl restart uwu-code uwu-code-openclaw
```

## Scheduler

Tasks created in `/scheduler`. Supported types:

- **Research** — openclaw answers using the LLM API directly (OpenRouter preferred)
- **Coding** — spawns an OpenCode Server session in the selected workspace

Running tasks show a live activity feed with tool calls, AI responses, and file diffs. Users can send messages to intervene or abort.

## MCP Integration

uwu-code includes an MCP (Model Context Protocol) server for the Scheduler, enabling AI tools like OpenCode to programmatically manage tasks.

### MCP Server Tools

| Tool | Description |
|------|-------------|
| `scheduler_list_tasks` | List all tasks, optionally filter by status or type |
| `scheduler_create_task` | Create a new coding or research task |
| `scheduler_get_task` | Get details of a specific task |
| `scheduler_update_task` | Update task properties (status, schedule, etc.) |
| `scheduler_delete_task` | Delete a task from the queue |
| `scheduler_queue_now` | Immediately queue a task for execution |
| `scheduler_run_task` | Run a task via OpenCode Server |
| `scheduler_get_status` | Get openclaw agent status |
| `scheduler_get_agent_logs` | Read recent agent logs |

### MCP Configuration

For OpenCode, add to your `opencode.json`:

```json
{
  "mcpServers": {
    "uwu-scheduler": {
      "command": "npx",
      "args": ["tsx", "dashboard/mcp-scheduler-server.ts"]
    }
  }
}
```

Or use the global MCP config at `.mcp/config.json`.

### Usage Example

```bash
# Run opencode with the scheduler MCP server
opencode --mcp-config opencode.json

# Or in opencode's interactive mode:
# The scheduler tools will be available to create and manage tasks
```

## Settings

Visit `/settings` to:
- Add or rotate API keys (saved to `settings.json`, picked up by openclaw on next task)
- Set default models for OpenClaw (OpenRouter) and OpenCode
- Set a username + password to protect the dashboard behind a login page

Credentials are stored in `/opt/uwu-code/settings.json`. Sessions last 30 days.
