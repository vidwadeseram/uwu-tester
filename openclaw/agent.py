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
ENV_FILE = AGENT_DIR.parent / "regression_tests" / ".env"
POLL_INTERVAL = 10  # seconds

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

    return False, "No LLM API key configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in regression_tests/.env"


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
