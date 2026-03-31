"""
uwu-tester MCP server

Lightweight stdio MCP server using the official mcp SDK.
Exposes test projects, cases, and results as resources, and a tool
to check run status. The "run tests" tool is intentionally omitted
for Claude Code — Claude acts as the browser agent itself.

Usage:
  uv run mcp_server.py
"""

import json
import os
from pathlib import Path

from mcp.server.fastmcp import FastMCP

BASE_DIR = Path(__file__).parent
TEST_CASES_DIR = BASE_DIR / "test_cases"
RESULTS_DIR = BASE_DIR / "results"

mcp = FastMCP("uwu-tester")


# ── Resources ─────────────────────────────────────────────────────────────────


@mcp.resource("uwu://projects")
def list_projects() -> str:
    """List all available test project slugs."""
    projects = sorted(f.stem for f in TEST_CASES_DIR.glob("*.json"))
    return json.dumps({"projects": projects}, indent=2)


@mcp.resource("uwu://projects/{slug}/cases")
def get_test_cases(slug: str) -> str:
    """Get the full test cases config for a project."""
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
        [f for f in results_dir.glob("*.json") if f.stem != "running"],
        key=lambda f: f.stem,
        reverse=True,
    )[:10]

    summaries = []
    for run_file in run_files:
        try:
            data = json.loads(run_file.read_text())
            summaries.append({
                "run_id": data.get("run_id"),
                "started_at": data.get("started_at"),
                "total": data.get("total"),
                "passed": data.get("passed"),
                "failed": data.get("failed"),
                "skipped": data.get("skipped"),
            })
        except Exception:
            pass

    return json.dumps({"project": slug, "runs": summaries}, indent=2)


@mcp.resource("uwu://projects/{slug}/results/{run_id}")
def get_run_result(slug: str, run_id: str) -> str:
    """Get full per-case results for a specific test run."""
    result_file = RESULTS_DIR / slug / f"{run_id}.json"
    if not result_file.exists():
        raise ValueError(f"Run '{run_id}' not found for project '{slug}'")
    return result_file.read_text()


# ── Tools ─────────────────────────────────────────────────────────────────────


@mcp.tool()
def get_run_status(project: str) -> str:
    """
    Check whether a test_runner.py (Test via API) run is currently active.
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
    except Exception:
        running_file.unlink(missing_ok=True)
    return json.dumps({"running": False})


@mcp.tool()
def save_results(project: str, results_json: str) -> str:
    """
    Save a completed test run result written by Claude Code itself.
    results_json must be a JSON string matching the standard result format:
    {project, run_id, started_at, total, passed, failed, skipped, results:[...]}.
    Returns {saved: true, path} or {error}.
    """
    try:
        data = json.loads(results_json)
        run_id = data.get("run_id")
        if not run_id:
            return json.dumps({"error": "results_json must include a run_id field"})
        out_dir = RESULTS_DIR / project
        out_dir.mkdir(parents=True, exist_ok=True)
        out_file = out_dir / f"{run_id}.json"
        out_file.write_text(json.dumps(data, indent=2))
        return json.dumps({"saved": True, "path": str(out_file)})
    except Exception as e:
        return json.dumps({"error": str(e)})


if __name__ == "__main__":
    mcp.run()
