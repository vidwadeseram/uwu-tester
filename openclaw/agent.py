#!/usr/bin/env python3
"""
openclaw — autonomous task agent for uwu-code
Polls data/tasks.json every 10s.
- coding tasks  → opencode or claude CLI in the workspace
- research tasks → Anthropic / OpenAI / OpenRouter API directly
Rate-limit detection auto-reschedules the task 1 hour out.
"""
from __future__ import annotations

import json
import os
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
import re
from typing import Any

AGENT_DIR = Path(__file__).parent
DATA_DIR = AGENT_DIR / "data"
TASKS_FILE = DATA_DIR / "tasks.json"
STATUS_FILE = DATA_DIR / "status.json"
LOG_FILE = DATA_DIR / "agent.log"
SETTINGS_FILE = AGENT_DIR.parent / "settings.json"
ENV_FILE = AGENT_DIR / ".env"
POLL_INTERVAL = 10  # seconds
from audit import (
    log_task_created,
    log_task_updated,
    log_task_cancelled,
    get_rate_limiter,
)

TaskDict = dict[str, Any]


# ── bootstrap ────────────────────────────────────────────────────────────────

DATA_DIR.mkdir(parents=True, exist_ok=True)


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


# ── logging ──────────────────────────────────────────────────────────────────

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def log(msg: str) -> None:
    line = f"[{now_iso()}] {msg}"
    print(line, flush=True)
    try:
        with LOG_FILE.open("a") as f:
            f.write(line + "\n")
        # Trim to last 4000 lines
        lines = LOG_FILE.read_text().splitlines()
        if len(lines) > 5000:
            LOG_FILE.write_text("\n".join(lines[-4000:]) + "\n")
    except Exception:
        pass


# ── task persistence ──────────────────────────────────────────────────────────

def load_tasks() -> list[TaskDict]:
    if not TASKS_FILE.exists():
        return []
    try:
        return json.loads(TASKS_FILE.read_text())
    except Exception:
        return []


def save_tasks(tasks: list[TaskDict]) -> None:
    TASKS_FILE.write_text(json.dumps(tasks, indent=2))


def update_task(task_id: str, **fields: Any) -> None:
    tasks = load_tasks()
    for t in tasks:
        if t["id"] == task_id:
            t.update(fields)
            break
    save_tasks(tasks)


def update_status(state: str, current_task_id: str | None = None, message: str = "") -> None:
    try:
        STATUS_FILE.write_text(json.dumps({
            "state": state,
            "current_task_id": current_task_id,
            "message": message,
            "updated_at": now_iso(),
            "pid": os.getpid(),
        }, indent=2))
    except Exception:
        pass


# ── task creation helpers ─────────────────────────────────────────────────────

def validate_task_fields(data: dict[str, Any]) -> tuple[bool, str]:
    if not data.get("description"):
        return False, "description is required"
    task_type = data.get("type")
    if task_type and task_type not in ("coding", "research"):
        return False, "type must be 'coding' or 'research'"
    schedule_mode = data.get("schedule_mode")
    if schedule_mode and schedule_mode not in ("anytime", "once", "daily", "weekly", "manual"):
        return False, "schedule_mode must be one of: anytime, once, daily, weekly, manual"
    preferred_tool = data.get("preferred_tool")
    if preferred_tool and preferred_tool not in ("claude", "opencode", "auto"):
        return False, "preferred_tool must be one of: claude, opencode, auto"
    return True, ""


def create_task(
    title: str | None = None,
    description: str = "",
    task_type: str = "research",
    workspace: str | None = None,
    preferred_tool: str = "auto",
    schedule_mode: str = "anytime",
    schedule_time: str | None = None,
    schedule_weekday: int | None = None,
    one_time_at: str | None = None,
    use_api: bool = True,
) -> dict[str, Any] | None:
    task_data = {
        "title": title or description[:60].strip(),
        "description": description,
        "type": task_type,
        "workspace": workspace if task_type == "coding" else None,
        "preferred_tool": preferred_tool if task_type == "coding" else None,
        "schedule_mode": schedule_mode,
        "schedule_time": schedule_time,
        "schedule_weekday": schedule_weekday,
        "one_time_at": one_time_at,
    }
    task_data = {k: v for k, v in task_data.items() if v is not None}

    valid, error = validate_task_fields(task_data)
    if not valid:
        log(f"create_task validation failed: {error}")
        return None

    if use_api:
        try:
            from api_client import get_api_client
            client = get_api_client()
            task = client.create_task(task_data)
            log(f"Created task via API: {task.get('id', 'unknown')} - {task_data.get('title', task_data.get('description', ''))[:50]}")
            return task
        except Exception as e:
            log(f"Failed to create task via API: {e}")
            return None

    tasks = load_tasks()
    task_id = str(os.urandom(16).hex())
    now = now_iso()
    new_task: TaskDict = {
        "id": task_id,
        "title": task_data.get("title", description[:60]),
        "type": task_data.get("type", "research"),
        "description": task_data.get("description", ""),
        "workspace": task_data.get("workspace"),
        "preferred_tool": task_data.get("preferred_tool", "auto"),
        "status": "pending",
        "schedule_mode": task_data.get("schedule_mode", "anytime"),
        "schedule_time": task_data.get("schedule_time"),
        "schedule_weekday": task_data.get("schedule_weekday"),
        "created_at": now,
    }
    tasks.append(new_task)
    save_tasks(tasks)
    log(f"Created task: {task_id} - {new_task.get('title', '')[:50]}")
    # Audit: log task creation
    try:
        log_task_created(
            task_id,
            str(new_task.get("title") if new_task.get("title") is not None else ""),
            str(new_task.get("type") if new_task.get("type") is not None else ""),
            str(new_task.get("schedule_mode") if new_task.get("schedule_mode") is not None else ""),
        )
    except Exception:
        pass
    return new_task


def create_followup_task(
    parent_task: TaskDict,
    description: str,
    task_type: str = "coding",
    schedule_mode: str = "anytime",
    workspace: str | None = None,
) -> dict[str, Any] | None:
    followup_desc = f"[Follow-up from: {parent_task.get('title', parent_task.get('id', 'unknown'))}]\n{description}"
    return create_task(
        description=followup_desc,
        task_type=task_type,
        workspace=workspace or parent_task.get("workspace"),
        preferred_tool=parent_task.get("preferred_tool", "auto"),
        schedule_mode=schedule_mode,
    )


def create_recurring_task(
    description: str,
    schedule_time: str,
    schedule_weekday: int | None = None,
    task_type: str = "research",
    workspace: str | None = None,
    preferred_tool: str = "auto",
) -> dict[str, Any] | None:
    return create_task(
        description=description,
        task_type=task_type,
        workspace=workspace,
        preferred_tool=preferred_tool,
        schedule_mode="weekly" if schedule_weekday is not None else "daily",
        schedule_time=schedule_time,
        schedule_weekday=schedule_weekday,
    )


TEMPLATE_TASKS: dict[str, dict[str, Any]] = {
    "deploy_check": {
        "description": "Check deployment status and verify all services are running correctly",
        "type": "coding",
        "preferred_tool": "auto",
        "schedule_mode": "manual",
    },
    "dependency_update": {
        "description": "Check for outdated dependencies and create update PRs if available",
        "type": "coding",
        "preferred_tool": "auto",
        "schedule_mode": "weekly",
        "schedule_time": "02:00",
        "schedule_weekday": 0,
    },
    "health_check": {
        "description": "Run system health check and verify all services are operational",
        "type": "research",
        "schedule_mode": "daily",
        "schedule_time": "09:00",
    },
    "security_scan": {
        "description": "Run security scan and review for any vulnerabilities",
        "type": "coding",
        "preferred_tool": "auto",
        "schedule_mode": "weekly",
        "schedule_time": "03:00",
        "schedule_weekday": 1,
    },
}


def create_template_task(
    template_name: str,
    workspace: str | None = None,
) -> dict[str, Any] | None:
    template = TEMPLATE_TASKS.get(template_name)
    if not template:
        log(f"Unknown template: {template_name}")
        return None
    return create_task(
        description=template["description"],
        task_type=template["type"],
        workspace=workspace,
        preferred_tool=template.get("preferred_tool", "auto"),
        schedule_mode=template["schedule_mode"],
        schedule_time=template.get("schedule_time"),
        schedule_weekday=template.get("schedule_weekday"),
    )


# ── task editing helpers ──────────────────────────────────────────────────────

MUTABLE_FIELDS = {
    "title", "description", "status", "schedule_mode",
    "schedule_time", "schedule_weekday", "preferred_tool", "workspace",
    "scheduled_at", "one_time_at",
}


def update_existing_task(
    task_id: str,
    updates: dict[str, Any],
    use_api: bool = True,
) -> dict[str, Any] | None:
    invalid_fields = [k for k in updates.keys() if k not in MUTABLE_FIELDS]
    if invalid_fields:
        log(f"update_existing_task: invalid fields {invalid_fields}")
        return None

    if use_api:
        try:
            from api_client import get_api_client
            client = get_api_client()
            task = client.update_task(task_id, updates)
            log(f"Updated task {task_id} via API: {list(updates.keys())}")
            # Audit: log task update
            try:
                log_task_updated(task_id, updates as any)
            except Exception:
                pass
            return task
        except Exception as e:
            log(f"Failed to update task via API: {e}")
            return None

    tasks = load_tasks()
    for i, t in enumerate(tasks):
        if t.get("id") == task_id:
            log(f"Updating task {task_id}: {list(updates.keys())}")
            tasks[i].update(updates)
            save_tasks(tasks)
            # Audit: log task update
            try:
                log_task_updated(task_id, updates as any)
            except Exception:
                pass
            return tasks[i]
    log(f"Task {task_id} not found")
    return None


def reschedule_task(
    task_id: str,
    schedule_mode: str = "anytime",
    schedule_time: str | None = None,
    schedule_weekday: int | None = None,
    one_time_at: str | None = None,
) -> dict[str, Any] | None:
    updates: dict[str, Any] = {"schedule_mode": schedule_mode}
    if schedule_time is not None:
        updates["schedule_time"] = schedule_time
    if schedule_weekday is not None:
        updates["schedule_weekday"] = schedule_weekday
    if one_time_at is not None:
        updates["scheduled_at"] = one_time_at
        updates["status"] = "scheduled"
    log(f"Rescheduling task {task_id} to {schedule_mode}")
    return update_existing_task(task_id, updates)


def cancel_task(task_id: str) -> dict[str, Any] | None:
    log(f"Cancelling task {task_id}")
    return update_existing_task(task_id, {"status": "cancelled"})


def postpone_task(task_id: str, hours: int = 1) -> dict[str, Any] | None:
    from datetime import timedelta
    next_run = datetime.now(timezone.utc) + timedelta(hours=hours)
    iso_time = next_run.isoformat()
    log(f"Postponing task {task_id} by {hours}h to {iso_time}")
    return update_existing_task(task_id, {
        "status": "scheduled",
        "scheduled_at": iso_time,
    })


def update_task_description(task_id: str, description: str) -> dict[str, Any] | None:
    return update_existing_task(task_id, {"description": description})


def update_task_status(task_id: str, status: str) -> dict[str, Any] | None:
    valid_statuses = {"pending", "running", "completed", "failed", "scheduled", "manual", "cancelled"}
    if status not in valid_statuses:
        log(f"Invalid status: {status}")
        return None
    return update_existing_task(task_id, {"status": status})


# ── task chaining helpers ─────────────────────────────────────────────────────

CHAIN_WORKFLOWS: dict[str, list[dict[str, Any]]] = {
    "code_test_deploy": [
        {"type": "coding", "description": "Write and implement code changes", "preferred_tool": "auto"},
        {"type": "coding", "description": "Run tests and verify functionality", "preferred_tool": "auto"},
        {"type": "coding", "description": "Deploy changes to target environment", "preferred_tool": "auto"},
    ],
    "research_plan_implement": [
        {"type": "research", "description": "Research topic and gather information", "preferred_tool": "auto"},
        {"type": "coding", "description": "Create implementation plan based on research", "preferred_tool": "auto"},
        {"type": "coding", "description": "Implement the planned solution", "preferred_tool": "auto"},
    ],
    "audit_fix_verify": [
        {"type": "research", "description": "Audit current state and identify issues", "preferred_tool": "auto"},
        {"type": "coding", "description": "Fix identified issues", "preferred_tool": "auto"},
        {"type": "coding", "description": "Verify fixes and validate results", "preferred_tool": "auto"},
    ],
}


def create_chain(
    workflow_name: str,
    workspace: str | None = None,
    parent_task_id: str | None = None,
) -> list[dict[str, Any]]:
    tasks = []
    workflow = CHAIN_WORKFLOWS.get(workflow_name, [])
    if not workflow:
        log(f"Unknown chain workflow: {workflow_name}")
        return []

    for i, step in enumerate(workflow):
        chain_context = f"[Chain: {workflow_name}] " if i > 0 else ""
        task = create_task(
            description=chain_context + step["description"],
            task_type=step.get("type", "coding"),
            workspace=workspace,
            preferred_tool=step.get("preferred_tool", "auto"),
            schedule_mode="manual",
        )
        if task:
            if parent_task_id:
                update_existing_task(task["id"], {"parent_task_id": parent_task_id})
            if i > 0 and tasks:
                prev_task = tasks[-1]
                update_existing_task(prev_task["id"], {"chain_next_id": task["id"]})
            tasks.append(task)

    if tasks and parent_task_id:
        update_existing_task(parent_task_id, {"chain_next_id": tasks[0]["id"]})

    log(f"Created chain '{workflow_name}' with {len(tasks)} tasks")
    return tasks


def continue_chain(
    completed_task: TaskDict,
    outcome: str = "success",
) -> dict[str, Any] | None:
    chain_next_id = completed_task.get("chain_next_id")
    if not chain_next_id:
        chain_id = completed_task.get("chain_id")
        if chain_id:
            tasks = load_tasks()
            for t in tasks:
                if t.get("id") == chain_id and t.get("chain_next_id"):
                    chain_next_id = t.get("chain_next_id")
                    break

    if not chain_next_id:
        return None

    if outcome == "failure" and completed_task.get("chain_stop_on_failure", True):
        log(f"Chain stopped due to task failure: {completed_task.get('id')}")
        return None

    next_task = update_existing_task(chain_next_id, {"status": "pending"})
    if next_task:
        log(f"Chain continued: started next task {chain_next_id}")
    return next_task


def get_chain_tasks(chain_id: str) -> list[dict[str, Any]]:
    tasks = load_tasks()
    chain_tasks = []
    current_id = None
    for t in tasks:
        if t.get("id") == chain_id:
            chain_tasks.append(t)
            current_id = t.get("chain_next_id")
            break

    while current_id:
        for t in tasks:
            if t.get("id") == current_id:
                chain_tasks.append(t)
                current_id = t.get("chain_next_id")
                break
        else:
            break

    return chain_tasks


# ── scheduling ────────────────────────────────────────────────────────────────

RATE_LIMIT_PHRASES = [
    "rate limit", "rate_limit", "429", "quota exceeded",
    "too many requests", "usage limit", "overloaded",
    "529", "credit", "billing",
]

SUNDAY_BASED_WEEKDAY = {
    0: 6,
    1: 0,
    2: 1,
    3: 2,
    4: 3,
    5: 4,
    6: 5,
}


def is_rate_limited(text: str) -> bool:
    lo = text.lower()
    return any(p in lo for p in RATE_LIMIT_PHRASES)


def parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
        if not parsed.tzinfo:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


def parse_schedule_time(value: str | None) -> tuple[int, int] | None:
    if not value or not re.match(r"^(?:[01]\d|2[0-3]):[0-5]\d$", value):
        return None
    hour, minute = value.split(":")
    return int(hour), int(minute)


def next_daily_run(task: TaskDict, now: datetime) -> datetime:
    parsed_time = parse_schedule_time(task.get("schedule_time"))
    if parsed_time:
        hour, minute = parsed_time
        candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if candidate <= now:
            candidate += timedelta(days=1)
        return candidate

    candidate = parse_iso_datetime(task.get("scheduled_at")) or now
    while candidate <= now:
        candidate += timedelta(days=1)
    return candidate


def next_weekly_run(task: TaskDict, now: datetime) -> datetime:
    parsed_time = parse_schedule_time(task.get("schedule_time"))
    weekday = task.get("schedule_weekday")

    if parsed_time and isinstance(weekday, int) and 0 <= weekday <= 6:
        py_weekday = SUNDAY_BASED_WEEKDAY[weekday]
        days_ahead = (py_weekday - now.weekday() + 7) % 7
        hour, minute = parsed_time
        candidate = (now + timedelta(days=days_ahead)).replace(
            hour=hour,
            minute=minute,
            second=0,
            microsecond=0,
        )
        if candidate <= now:
            candidate += timedelta(days=7)
        return candidate

    candidate = parse_iso_datetime(task.get("scheduled_at")) or now
    while candidate <= now:
        candidate += timedelta(days=7)
    return candidate


def compute_next_recurring_run(task: TaskDict, now: datetime) -> datetime | None:
    mode = task.get("schedule_mode", "anytime")
    if mode == "daily":
        return next_daily_run(task, now)
    if mode == "weekly":
        return next_weekly_run(task, now)
    return None


def get_next_task(tasks: list[TaskDict]) -> TaskDict | None:
    now = datetime.now(timezone.utc)
    for task in tasks:
        if task["status"] == "pending":
            return task
        if task["status"] == "manual":
            continue
        if task["status"] == "scheduled":
            t = parse_iso_datetime(task.get("scheduled_at"))
            if t and t <= now:
                return task
    return None


# ── executors ────────────────────────────────────────────────────────────────

def run_coding_task(task: TaskDict) -> tuple[bool | None, str]:
    """
    Returns (True, output) on success, (False, output) on failure,
    (None, output) if rate-limited.
    """
    workspace = task.get("workspace") or "/opt/workspaces"
    desc = task["description"]
    pref = task.get("preferred_tool", "auto")

    # Build ordered list of commands to try
    # --dangerously-skip-permissions required: Claude refuses to run as root
    claude_cmd = ["claude", "--dangerously-skip-permissions", "--print", desc]
    opencode_cmd = ["opencode", "run", desc]

    if pref == "claude":
        commands = [claude_cmd]
    elif pref == "opencode":
        commands = [opencode_cmd, claude_cmd]
    else:  # auto
        commands = [opencode_cmd, claude_cmd]

    last_output = ""
    for cmd in commands:
        tool_name = cmd[0]
        log(f"  → trying {tool_name} in {workspace}")
        try:
            proc = subprocess.run(
                cmd,
                cwd=workspace,
                capture_output=True,
                text=True,
                timeout=600,
                env={**os.environ},
            )
            output = proc.stdout
            if proc.stderr.strip():
                output += "\n\n--- stderr ---\n" + proc.stderr
            last_output = output

            if is_rate_limited(output):
                return None, output

            if proc.returncode == 0:
                return True, f"**Tool:** {tool_name}\n**Workspace:** {workspace}\n\n{output}"

            # Non-zero exit — try next tool
            log(f"  {tool_name} exited {proc.returncode}, trying next...")

        except subprocess.TimeoutExpired:
            return False, f"Timed out after 10 minutes (tool: {tool_name})"
        except FileNotFoundError:
            log(f"  {tool_name} not found, skipping")

    return False, f"All tools failed.\n\nLast output:\n{last_output}"


def run_research_task(task: TaskDict) -> tuple[bool | None, str]:
    desc = task["description"]
    log("  → running research via LLM API")

    anthropic_key  = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    openai_key     = os.environ.get("OPENAI_API_KEY", "").strip()
    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "").strip()

    # Read model preference from settings.json (set via /settings UI)
    or_model = "anthropic/claude-opus-4"
    try:
        or_model = json.loads(SETTINGS_FILE.read_text()).get("models", {}).get("openclaw") or or_model
    except Exception:
        pass

    # ── 1. OpenRouter (preferred — most flexible, access to many models) ──────
    if openrouter_key:
        try:
            oai = __import__("openai")
            client = oai.OpenAI(
                api_key=openrouter_key,
                base_url="https://openrouter.ai/api/v1",
            )
            resp = client.chat.completions.create(
                model=or_model,
                messages=[{"role": "user", "content": desc}],
            )
            return True, resp.choices[0].message.content or ""
        except Exception as e:
            err = str(e)
            log(f"  OpenRouter error: {err[:200]}")
            if is_rate_limited(err):
                return None, err
            # fall through to Anthropic direct

    # ── 2. Anthropic direct ───────────────────────────────────────────────────
    if anthropic_key:
        try:
            anthropic = __import__("anthropic")
            client = anthropic.Anthropic(api_key=anthropic_key)
            msg = client.messages.create(
                model="claude-opus-4-5-20251101",
                max_tokens=8192,
                messages=[{"role": "user", "content": desc}],
            )
            return True, msg.content[0].text
        except Exception as e:
            err = str(e)
            log(f"  Anthropic error: {err[:200]}")
            if is_rate_limited(err):
                return None, err

    # ── 3. OpenAI direct ──────────────────────────────────────────────────────
    if openai_key:
        try:
            oai = __import__("openai")
            client = oai.OpenAI(api_key=openai_key)
            resp = client.chat.completions.create(
                model="gpt-4o",
                messages=[{"role": "user", "content": desc}],
            )
            return True, resp.choices[0].message.content or ""
        except Exception as e:
            err = str(e)
            log(f"  OpenAI error: {err[:200]}")
            if is_rate_limited(err):
                return None, err

    return False, "No LLM API key configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in settings or .env"


# ── task runner ───────────────────────────────────────────────────────────────

def process_task(task: TaskDict) -> None:
    tid = task["id"]
    schedule_mode = task.get("schedule_mode", "anytime")
    log(f"Starting task [{tid}] type={task.get('type','research')}: {task['description'][:80]}")

    update_task(tid, status="running", started_at=now_iso())
    update_status("running", tid, task["description"][:120])

    try:
        if task.get("type") == "coding":
            result, output = run_coding_task(task)
        else:
            result, output = run_research_task(task)
    except Exception as e:
        log(f"  Crashed: {e}")
        result, output = False, f"Unexpected error: {e}"

    header = (
        f"# Task Report\n\n"
        f"**ID:** `{tid}`  \n"
        f"**Type:** {task.get('type','research')}  \n"
        f"**Description:** {task['description']}  \n"
    )
    if task.get("workspace"):
        header += f"**Workspace:** {task['workspace']}  \n"
    if task.get("preferred_tool"):
        header += f"**Tool preference:** {task['preferred_tool']}  \n"
    header += f"**Completed:** {now_iso()}  \n\n---\n\n"

    if result is None:
        rate_limited_report = (
            f"{header}⏳ Rate limited.\n\n"
            f"API response:\n```\n{output[:2000]}\n```"
        )
        if schedule_mode == "manual":
            update_task(
                tid,
                status="manual",
                last_run_at=now_iso(),
                last_run_status="failed",
                report=rate_limited_report,
            )
            log("  Rate limited (manual task remains manual)")
        else:
            scheduled = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
            update_task(
                tid,
                status="scheduled",
                scheduled_at=scheduled,
                last_run_at=now_iso(),
                last_run_status="failed",
                report=f"{rate_limited_report}\n\nAuto-rescheduled for **{scheduled}**.",
            )
            log(f"  Rate limited → rescheduled to {scheduled}")
    elif result:
        next_run = compute_next_recurring_run(task, datetime.now(timezone.utc))
        if schedule_mode == "manual":
            update_task(
                tid,
                status="manual",
                completed_at=now_iso(),
                last_run_at=now_iso(),
                last_run_status="completed",
                report=header + output,
            )
            log("  Completed successfully (manual task reset)")
        elif next_run:
            update_task(
                tid,
                status="scheduled",
                scheduled_at=next_run.isoformat(),
                completed_at=now_iso(),
                last_run_at=now_iso(),
                last_run_status="completed",
                report=header + output,
            )
            log(f"  Completed successfully → next run at {next_run.isoformat()}")
        else:
            update_task(
                tid,
                status="completed",
                completed_at=now_iso(),
                last_run_at=now_iso(),
                last_run_status="completed",
                report=header + output,
            )
            log(f"  Completed successfully")
    else:
        next_run = compute_next_recurring_run(task, datetime.now(timezone.utc))
        if schedule_mode == "manual":
            update_task(
                tid,
                status="manual",
                completed_at=now_iso(),
                last_run_at=now_iso(),
                last_run_status="failed",
                report=f"{header}❌ Failed:\n\n```\n{output}\n```",
            )
            log("  Failed (manual task reset)")
        elif next_run:
            update_task(
                tid,
                status="scheduled",
                scheduled_at=next_run.isoformat(),
                completed_at=now_iso(),
                last_run_at=now_iso(),
                last_run_status="failed",
                report=f"{header}❌ Failed:\n\n```\n{output}\n```",
            )
            log(f"  Failed → next run at {next_run.isoformat()}")
        else:
            update_task(
                tid,
                status="failed",
                completed_at=now_iso(),
                last_run_at=now_iso(),
                last_run_status="failed",
                report=f"{header}❌ Failed:\n\n```\n{output}\n```",
            )
            log(f"  Failed")

    update_status("idle")


# ── main loop ─────────────────────────────────────────────────────────────────

def main() -> None:
    load_dotenv(ENV_FILE)
    log(f"openclaw agent started (pid={os.getpid()})")
    update_status("idle")

    while True:
        try:
            tasks = load_tasks()
            task = get_next_task(tasks)
            if task:
                process_task(task)
            else:
                update_status("idle")
        except KeyboardInterrupt:
            log("openclaw shutting down")
            update_status("stopped")
            break
        except Exception as e:
            log(f"Agent loop error: {e}")
            update_status("error", message=str(e))

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
