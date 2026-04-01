"""
uwu-code MCP server — minimal stdlib-only implementation

Zero external dependencies. Starts in <200ms (vs 1.5s+ with fastmcp/mcp SDKs).
Speaks JSON-RPC 2.0 over stdout with newline-delimited messages.

Resources:
  uwu://projects                         — list all project slugs
  uwu://projects/{slug}/cases            — test cases JSON
  uwu://projects/{slug}/results          — last 10 run summaries
  uwu://projects/{slug}/results/{run_id} — full result for one run

Tools:
  get_run_status(project)                — check if test_runner.py is running
  save_results(project, results_json)    — persist self-run results from Claude Code
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

BASE_DIR = Path(__file__).parent
TEST_CASES_DIR = BASE_DIR / "test_cases"
RESULTS_DIR = BASE_DIR / "results"

SERVER_INFO = {"name": "uwu-code", "version": "1.0.0"}
PROTOCOL_VERSION = "2024-11-05"

TOOLS = [
    {
        "name": "get_run_status",
        "description": "Check whether a Test-via-API run (test_runner.py) is currently active for a project.",
        "inputSchema": {
            "type": "object",
            "properties": {"project": {"type": "string", "description": "Project slug"}},
            "required": ["project"],
        },
    },
    {
        "name": "save_results",
        "description": (
            "Save test results written by Claude Code itself after self-executing tests. "
            "results_json must match the standard format: "
            "{project, run_id, started_at, total, passed, failed, skipped, results:[...]}."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "project": {"type": "string"},
                "results_json": {"type": "string", "description": "JSON string of the run result"},
            },
            "required": ["project", "results_json"],
        },
    },
]

RESOURCES = [
    {"uri": "uwu://projects", "name": "Projects", "description": "List all test project slugs", "mimeType": "application/json"},
]


def _resource_templates():
    return [
        {"uriTemplate": "uwu://projects/{slug}/cases",     "name": "Test cases",       "description": "Test cases config for a project",       "mimeType": "application/json"},
        {"uriTemplate": "uwu://projects/{slug}/results",   "name": "Results summary",  "description": "Last 10 run summaries for a project",    "mimeType": "application/json"},
        {"uriTemplate": "uwu://projects/{slug}/results/{run_id}", "name": "Run result", "description": "Full results for a specific run",        "mimeType": "application/json"},
    ]


# ── Resource handlers ─────────────────────────────────────────────────────────

def handle_list_projects() -> str:
    projects = sorted(f.stem for f in TEST_CASES_DIR.glob("*.json"))
    return json.dumps({"projects": projects}, indent=2)


def handle_get_cases(slug: str) -> str:
    f = TEST_CASES_DIR / f"{slug}.json"
    if not f.exists():
        raise ValueError(f"Project '{slug}' not found")
    return f.read_text()


def handle_get_results_summary(slug: str) -> str:
    rd = RESULTS_DIR / slug
    if not rd.exists():
        return json.dumps({"project": slug, "runs": []}, indent=2)
    files = sorted(
        [f for f in rd.glob("*.json") if f.stem != "running"],
        key=lambda f: f.stem, reverse=True,
    )[:10]
    summaries = []
    for rf in files:
        try:
            d = json.loads(rf.read_text())
            summaries.append({k: d.get(k) for k in ("run_id", "started_at", "total", "passed", "failed", "skipped")})
        except Exception:
            pass
    return json.dumps({"project": slug, "runs": summaries}, indent=2)


def handle_get_run_result(slug: str, run_id: str) -> str:
    f = RESULTS_DIR / slug / f"{run_id}.json"
    if not f.exists():
        raise ValueError(f"Run '{run_id}' not found for project '{slug}'")
    return f.read_text()


def read_resource(uri: str) -> str:
    if uri == "uwu://projects":
        return handle_list_projects()
    parts = uri.removeprefix("uwu://projects/").split("/")
    if len(parts) == 2 and parts[1] == "cases":
        return handle_get_cases(parts[0])
    if len(parts) == 2 and parts[1] == "results":
        return handle_get_results_summary(parts[0])
    if len(parts) == 3 and parts[1] == "results":
        return handle_get_run_result(parts[0], parts[2])
    raise ValueError(f"Unknown resource: {uri}")


# ── Tool handlers ─────────────────────────────────────────────────────────────

def tool_get_run_status(project: str) -> str:
    running_file = RESULTS_DIR / project / "running.json"
    if not running_file.exists():
        return json.dumps({"running": False})
    try:
        info = json.loads(running_file.read_text())
        pid = info.get("pid")
        if pid:
            try:
                os.kill(pid, 0)
                return json.dumps({"running": True, **info})
            except (ProcessLookupError, PermissionError):
                running_file.unlink(missing_ok=True)
    except Exception:
        running_file.unlink(missing_ok=True)
    return json.dumps({"running": False})


def tool_save_results(project: str, results_json: str) -> str:
    try:
        data = json.loads(results_json)
        run_id = data.get("run_id") or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        data.setdefault("run_id", run_id)
        out_dir = RESULTS_DIR / project
        out_dir.mkdir(parents=True, exist_ok=True)
        out_file = out_dir / f"{run_id}.json"
        out_file.write_text(json.dumps(data, indent=2))
        return json.dumps({"saved": True, "path": str(out_file)})
    except Exception as e:
        return json.dumps({"error": str(e)})


def call_tool(name: str, args: dict) -> str:
    if name == "get_run_status":
        return tool_get_run_status(args["project"])
    if name == "save_results":
        return tool_save_results(args["project"], args["results_json"])
    raise ValueError(f"Unknown tool: {name}")


# ── JSON-RPC dispatcher ───────────────────────────────────────────────────────

def send(obj: dict):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def send_result(id_, result):
    send({"jsonrpc": "2.0", "id": id_, "result": result})


def send_error(id_, code: int, message: str):
    send({"jsonrpc": "2.0", "id": id_, "error": {"code": code, "message": message}})


def handle(msg: dict):
    method = msg.get("method", "")
    id_ = msg.get("id")
    params = msg.get("params") or {}

    if method == "initialize":
        send_result(id_, {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {
                "resources": {"listChanged": False},
                "tools": {"listChanged": False},
            },
            "serverInfo": SERVER_INFO,
        })

    elif method == "initialized":
        pass  # notification, no response

    elif method == "ping":
        send_result(id_, {})

    elif method == "resources/list":
        send_result(id_, {"resources": RESOURCES, "resourceTemplates": _resource_templates()})

    elif method == "resources/read":
        uri = params.get("uri", "")
        try:
            content = read_resource(uri)
            send_result(id_, {"contents": [{"uri": uri, "mimeType": "application/json", "text": content}]})
        except Exception as e:
            send_error(id_, -32000, str(e))

    elif method == "tools/list":
        send_result(id_, {"tools": TOOLS})

    elif method == "tools/call":
        name = params.get("name", "")
        args = params.get("arguments") or {}
        try:
            result = call_tool(name, args)
            send_result(id_, {"content": [{"type": "text", "text": result}]})
        except Exception as e:
            send_error(id_, -32000, str(e))

    elif id_ is not None:
        send_error(id_, -32601, f"Method not found: {method}")


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            handle(msg)
        except json.JSONDecodeError:
            send_error(None, -32700, "Parse error")
        except Exception as e:
            send_error(None, -32603, f"Internal error: {e}")


if __name__ == "__main__":
    main()
