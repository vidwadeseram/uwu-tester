"""
uwu-tester MCP server

Exposes test projects, cases, and results as MCP resources, and provides
tools to run tests and check status. Designed for use with Claude Code and
Opencode via stdio transport.

Resources:
  uwu://projects                          — list all projects
  uwu://projects/{slug}/cases             — test cases JSON for a project
  uwu://projects/{slug}/results           — recent run summaries (last 10)
  uwu://projects/{slug}/results/{run_id}  — full results for one run

Tools:
  run_tests(project, env_vars?)           — spawn test_runner.py in background
  get_run_status(project)                 — check if tests are running

Usage:
  uv run mcp_server.py
"""

import json
import os
import subprocess
import sys
from pathlib import Path

from fastmcp import FastMCP

mcp = FastMCP(
    "uwu-tester",
    description="Browser-use regression test manager for uwu-tester projects",
)

BASE_DIR = Path(__file__).parent
TEST_CASES_DIR = BASE_DIR / "test_cases"
RESULTS_DIR = BASE_DIR / "results"


# ── Resources ─────────────────────────────────────────────────────────────────


@mcp.resource("uwu://projects")
def list_projects() -> str:
    """List all available test projects (slugs)."""
    projects = sorted(f.stem for f in TEST_CASES_DIR.glob("*.json"))
    return json.dumps({"projects": projects}, indent=2)


@mcp.resource("uwu://projects/{slug}/cases")
def get_test_cases(slug: str) -> str:
    """Get the test cases configuration for a project."""
    cases_file = TEST_CASES_DIR / f"{slug}.json"
    if not cases_file.exists():
        raise ValueError(f"Project '{slug}' not found")
    return cases_file.read_text()


@mcp.resource("uwu://projects/{slug}/results")
def get_results_summary(slug: str) -> str:
    """Get summaries of the last 10 test runs for a project."""
    results_dir = RESULTS_DIR / slug
    if not results_dir.exists():
        return json.dumps({"project": slug, "runs": []}, indent=2)

    run_files = sorted(
        [f for f in results_dir.glob("*.json") if f.stem not in ("running",)],
        key=lambda f: f.stem,
        reverse=True,
    )[:10]

    summaries = []
    for run_file in run_files:
        try:
            data = json.loads(run_file.read_text())
            summaries.append(
                {
                    "run_id": data.get("run_id"),
                    "started_at": data.get("started_at"),
                    "total": data.get("total"),
                    "passed": data.get("passed"),
                    "failed": data.get("failed"),
                    "skipped": data.get("skipped"),
                }
            )
        except Exception:
            pass

    return json.dumps({"project": slug, "runs": summaries}, indent=2)


@mcp.resource("uwu://projects/{slug}/results/{run_id}")
def get_run_result(slug: str, run_id: str) -> str:
    """Get full results (including per-case details) for a specific test run."""
    result_file = RESULTS_DIR / slug / f"{run_id}.json"
    if not result_file.exists():
        raise ValueError(f"Run '{run_id}' not found for project '{slug}'")
    return result_file.read_text()


# ── Tools ─────────────────────────────────────────────────────────────────────


@mcp.tool()
def run_tests(project: str, env_vars: dict[str, str] | None = None) -> str:
    """
    Spawn the test runner for a project in the background.

    Args:
        project: The project slug (must match a file in test_cases/).
        env_vars: Optional key=value pairs passed to the runner
                  (e.g. {"BASE_URL": "https://example.com", "PASSWORD": "secret"}).

    Returns JSON with {started, project, pid} or {error}.
    """
    cases_file = TEST_CASES_DIR / f"{project}.json"
    if not cases_file.exists():
        return json.dumps({"error": f"Project '{project}' not found"})

    running_file = RESULTS_DIR / project / "running.json"
    if running_file.exists():
        try:
            info = json.loads(running_file.read_text())
            pid = info.get("pid")
            if pid:
                try:
                    os.kill(pid, 0)
                    return json.dumps({"error": f"Tests already running (pid {pid})"})
                except (ProcessLookupError, PermissionError):
                    running_file.unlink(missing_ok=True)
        except Exception:
            running_file.unlink(missing_ok=True)

    # Locate uv
    uv_candidates = [
        "/usr/local/bin/uv",
        "/root/.local/bin/uv",
        "/root/.cargo/bin/uv",
        "/home/ubuntu/.local/bin/uv",
    ]
    uv_bin = next((p for p in uv_candidates if Path(p).exists()), "uv")

    cmd = [uv_bin, "run", "test_runner.py", project]
    for k, v in (env_vars or {}).items():
        cmd.append(f"{k}={v}")

    extra_env = {**os.environ, "PATH": f"{os.environ.get('PATH', '')}:/usr/local/bin:/root/.local/bin"}
    if env_vars:
        extra_env.update(env_vars)

    proc = subprocess.Popen(
        cmd,
        cwd=str(BASE_DIR),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=extra_env,
    )

    return json.dumps({"started": True, "project": project, "pid": proc.pid})


@mcp.tool()
def get_run_status(project: str) -> str:
    """
    Check whether tests are currently running for a project.

    Returns JSON with {running: bool, run_id?, started_at?, pid?}.
    """
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
                return json.dumps({"running": False})
    except Exception:
        running_file.unlink(missing_ok=True)
    return json.dumps({"running": False})


if __name__ == "__main__":
    mcp.run()
