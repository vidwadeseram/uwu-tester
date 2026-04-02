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
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

BASE_DIR = Path(__file__).parent
TEST_CASES_DIR = Path(os.getenv("UWU_TEST_CASES_DIR") or (BASE_DIR / "test_cases"))
RESULTS_DIR = Path(os.getenv("UWU_RESULTS_DIR") or (BASE_DIR / "results"))

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
    {
        "name": "get_otp",
        "description": (
            "Retrieve OTP for a project using configured source details. "
            "Reads project env vars (OTP_FETCH_INSTRUCTION / OTP_TMUX_SESSION / OTP_TMUX_WINDOW) "
            "and can accept an instruction override."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "project": {"type": "string", "description": "Project slug"},
                "instruction": {"type": "string", "description": "Optional OTP retrieval instruction override"},
            },
            "required": ["project"],
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
    projects = sorted(
        f.stem
        for f in TEST_CASES_DIR.glob("*.json")
        if not f.name.endswith(".env.json") and not f.name.startswith(".")
    )
    return json.dumps({"projects": projects}, indent=2)


def substitute_vars(text: str, env: dict[str, str]) -> str:
    for key, value in env.items():
        text = text.replace(f"{{{{{key}}}}}", value)
    return text


def read_project_env(slug: str) -> dict[str, str]:
    env_file = TEST_CASES_DIR / f"{slug}.env.json"
    if not env_file.exists():
        return {}
    try:
        payload = json.loads(env_file.read_text())
    except Exception:
        return {}
    if not isinstance(payload, dict):
        return {}
    out: dict[str, str] = {}
    for key, value in payload.items():
        if not isinstance(key, str):
            continue
        if isinstance(value, (str, int, float)):
            out[key] = str(value)
    return out


def handle_get_cases(slug: str) -> str:
    f = TEST_CASES_DIR / f"{slug}.json"
    if not f.exists():
        raise ValueError(f"Project '{slug}' not found")
    try:
        payload = json.loads(f.read_text())
    except Exception:
        return f.read_text()

    if not isinstance(payload, dict):
        return json.dumps(payload, indent=2)

    env = read_project_env(slug)
    if not env:
        return json.dumps(payload, indent=2)

    cases = payload.get("test_cases")
    if isinstance(cases, list):
        for case in cases:
            if not isinstance(case, dict):
                continue
            task = case.get("task")
            if isinstance(task, str):
                case["task"] = substitute_vars(task, env)

    return json.dumps(payload, indent=2)


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


def _extract_latest_otp(text: str) -> str:
    patterns = [
        r"(?:otp|verification code|one[- ]?time password|code)\D{0,20}(\d{4,8})",
        r"\b(\d{6})\b",
        r"\b(\d{4})\b",
    ]
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in reversed(lines):
        lowered = line.lower()
        if "otp" not in lowered and "verification" not in lowered and "code" not in lowered:
            continue
        for pattern in patterns:
            found = re.findall(pattern, line, flags=re.IGNORECASE)
            if found:
                return found[-1]

    whole = "\n".join(lines[-200:])
    for pattern in patterns:
        found = re.findall(pattern, whole, flags=re.IGNORECASE)
        if found:
            return found[-1]
    return ""


def _tmux_target_from_instruction(instruction: str) -> tuple[str, str]:
    text = (instruction or "").strip()
    if not text:
        return "", ""

    direct = re.search(r"([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+)", text)
    if direct:
        return direct.group(1), direct.group(2)

    session_match = re.search(r"\bsession\s*(?:=|:)?\s*['\"]?([A-Za-z0-9_.-]+)", text, flags=re.IGNORECASE)
    window_match = re.search(r"\b(?:window|tab|pane)\s*(?:=|:)?\s*['\"]?([A-Za-z0-9_.-]+)", text, flags=re.IGNORECASE)
    session = session_match.group(1) if session_match else ""
    window = window_match.group(1) if window_match else ""
    return session, window


def _read_otp_from_tmux(session: str, window: str, capture_lines: str) -> tuple[str, str]:
    line_count = capture_lines if capture_lines.isdigit() else "800"
    targets = [f"{session}:{window}"] if window else []
    targets.append(session)

    for target in targets:
        try:
            capture = subprocess.run(
                ["tmux", "capture-pane", "-pt", target, "-S", f"-{line_count}"],
                check=False,
                capture_output=True,
                text=True,
                timeout=5,
            )
        except Exception:
            continue

        output = (capture.stdout or "") + "\n" + (capture.stderr or "")
        otp = _extract_latest_otp(output)
        if otp:
            return otp, target

    return "", session if not window else f"{session}:{window}"


def tool_get_otp(project: str, instruction_override: str = "") -> str:
    env = read_project_env(project)
    env_instruction = env.get("OTP_FETCH_INSTRUCTION", "").strip()
    override_instruction = (instruction_override or "").strip()
    instruction = override_instruction or env_instruction
    target = env.get("OTP_TMUX_TARGET", "").strip()
    session = env.get("OTP_TMUX_SESSION", "").strip()
    window = env.get("OTP_TMUX_WINDOW", "").strip()
    capture_lines = env.get("OTP_TMUX_CAPTURE_LINES", "800").strip() or "800"

    if target and not session:
        if ":" in target:
            parts = target.split(":", 1)
            session = parts[0].strip()
            window = parts[1].strip()
        else:
            session = target

    if override_instruction:
        inferred_session, inferred_window = _tmux_target_from_instruction(override_instruction)
        if inferred_session:
            session = inferred_session
            window = inferred_window

    if not session:
        inferred_session, inferred_window = _tmux_target_from_instruction(instruction)
        if inferred_session:
            session = inferred_session
        if inferred_window and not window:
            window = inferred_window

    if not session:
        return json.dumps({
            "otp": "",
            "source": "",
            "error": "No OTP source configured. Set OTP_TMUX_SESSION or OTP_FETCH_INSTRUCTION.",
        })

    otp, source = _read_otp_from_tmux(session, window, capture_lines)
    if not otp:
        return json.dumps({
            "otp": "",
            "source": source,
            "instruction": instruction,
            "error": "OTP not found from configured tmux source",
        })

    return json.dumps({
        "otp": otp,
        "source": source,
        "instruction": instruction,
    })


def _require_str_arg(args: dict[str, object], key: str) -> str:
    value = args.get(key)
    if isinstance(value, str):
        return value
    raise ValueError(f"Invalid argument '{key}': expected string")


def call_tool(name: str, args: dict[str, object]) -> str:
    if name == "get_run_status":
        return tool_get_run_status(_require_str_arg(args, "project"))
    if name == "save_results":
        return tool_save_results(
            _require_str_arg(args, "project"),
            _require_str_arg(args, "results_json"),
        )
    if name == "get_otp":
        instruction = args.get("instruction")
        instruction_text = instruction if isinstance(instruction, str) else ""
        return tool_get_otp(_require_str_arg(args, "project"), instruction_text)
    raise ValueError(f"Unknown tool: {name}")


# ── JSON-RPC dispatcher ───────────────────────────────────────────────────────

def send(obj: dict[str, object]):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def send_result(id_, result):
    send({"jsonrpc": "2.0", "id": id_, "result": result})


def send_error(id_, code: int, message: str):
    send({"jsonrpc": "2.0", "id": id_, "error": {"code": code, "message": message}})


def handle(msg: dict[str, object]):
    method = msg.get("method", "")
    id_ = msg.get("id")
    params_obj = msg.get("params")
    params: dict[str, object] = params_obj if isinstance(params_obj, dict) else {}

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
        uri_obj = params.get("uri")
        uri = uri_obj if isinstance(uri_obj, str) else ""
        try:
            content = read_resource(uri)
            send_result(id_, {"contents": [{"uri": uri, "mimeType": "application/json", "text": content}]})
        except Exception as e:
            send_error(id_, -32000, str(e))

    elif method == "tools/list":
        send_result(id_, {"tools": TOOLS})

    elif method == "tools/call":
        name_obj = params.get("name")
        name = name_obj if isinstance(name_obj, str) else ""
        args_obj = params.get("arguments")
        args: dict[str, object] = args_obj if isinstance(args_obj, dict) else {}
        try:
            result = call_tool(name, args)
            tool_result: dict[str, object] = {"content": [{"type": "text", "text": result}]}
            try:
                structured = json.loads(result)
                if isinstance(structured, dict):
                    tool_result["structuredContent"] = structured
            except Exception:
                pass
            send_result(id_, tool_result)
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
