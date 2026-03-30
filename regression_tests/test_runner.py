"""
uwu-tester — browser-use test runner

Reads test cases from regression_tests/test_cases/<slug>.json,
runs each via browser-use Agent, and writes results to
regression_tests/results/<slug>/<timestamp>.json.

Usage:
  uv run test_runner.py <project_slug> [KEY=VALUE ...]

Required env vars (or pass as KEY=VALUE args):
  ANTHROPIC_API_KEY   — for claude-sonnet-4-6 (default LLM)

Any {{PLACEHOLDER}} in task strings is substituted with matching env vars.
"""

import asyncio
import json
import os
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from browser_use import Agent
from browser_use.browser.profile import BrowserProfile
from browser_use.llm.openrouter.chat import ChatOpenRouter

BASE_DIR = Path(__file__).parent
TEST_CASES_DIR = BASE_DIR / "test_cases"
RESULTS_DIR = BASE_DIR / "results"


@dataclass
class CaseResult:
    id: str
    label: str
    passed: bool
    detail: str
    duration_s: float
    skipped: bool = False


def substitute_vars(text: str, env: dict[str, str]) -> str:
    for key, val in env.items():
        text = text.replace(f"{{{{{key}}}}}", val)
    return text


async def run_case(
    case: dict,
    llm: ChatOpenRouter,
    profile: BrowserProfile,
    env: dict[str, str],
) -> CaseResult:
    label = case.get("label", case["id"])
    task = substitute_vars(case["task"], env)

    print(f"\n[{label}] Starting...")
    t0 = time.time()
    try:
        agent = Agent(task=task, llm=llm, browser_profile=profile)
        result = await agent.run()
        final = result.final_result() if result else None
        passed = result.is_successful() if result else False
        detail = str(final) if final else "No result returned"
        duration = time.time() - t0
        print(f"[{label}] {'PASS' if passed else 'FAIL'} ({duration:.1f}s): {detail[:100]}")
        return CaseResult(
            id=case["id"],
            label=label,
            passed=passed,
            detail=detail,
            duration_s=round(duration, 1),
        )
    except Exception as exc:
        duration = time.time() - t0
        print(f"[{label}] ERROR ({duration:.1f}s): {exc}")
        return CaseResult(
            id=case["id"],
            label=label,
            passed=False,
            detail=str(exc),
            duration_s=round(duration, 1),
        )


async def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1].startswith("-"):
        print("Usage: uv run test_runner.py <project_slug> [KEY=VALUE ...]")
        sys.exit(1)

    slug = sys.argv[1]

    # Parse KEY=VALUE overrides from args
    env: dict[str, str] = dict(os.environ)
    for arg in sys.argv[2:]:
        if "=" in arg:
            k, v = arg.split("=", 1)
            env[k] = v

    cases_file = TEST_CASES_DIR / f"{slug}.json"
    if not cases_file.exists():
        print(f"ERROR: Test cases file not found: {cases_file}")
        sys.exit(1)

    with cases_file.open() as f:
        config = json.load(f)

    all_cases: list[dict] = config.get("test_cases", [])
    enabled_cases = [tc for tc in all_cases if tc.get("enabled", True)]

    if not enabled_cases:
        print("No enabled test cases found.")
        sys.exit(0)

    print(f"\nuwu-tester: running {len(enabled_cases)} test case(s) for '{slug}'")
    print(f"Project: {config.get('description', slug)}\n")

    openrouter_key = env.get("OPENROUTER_API_KEY", "")
    if not openrouter_key:
        print("ERROR: OPENROUTER_API_KEY is not set")
        sys.exit(1)

    model = env.get("OPENROUTER_MODEL", "anthropic/claude-sonnet-4-5")
    llm = ChatOpenRouter(model=model, api_key=openrouter_key, timeout=120)
    print(f"LLM: OpenRouter / {model}")
    profile = BrowserProfile(headless=True, keep_alive=False)

    results: list[CaseResult] = []
    skipped_ids: set[str] = set()

    for case in enabled_cases:
        # Skip if a dependency failed and skip_dependents_on_fail was set
        depends_on = case.get("depends_on")
        if depends_on and depends_on in skipped_ids:
            results.append(
                CaseResult(
                    id=case["id"],
                    label=case.get("label", case["id"]),
                    passed=False,
                    detail=f"Skipped — dependency '{depends_on}' failed",
                    duration_s=0,
                    skipped=True,
                )
            )
            skipped_ids.add(case["id"])
            continue

        result = await run_case(case, llm, profile, env)
        results.append(result)

        if not result.passed and case.get("skip_dependents_on_fail", False):
            skipped_ids.add(case["id"])

    # Save results
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    results_dir = RESULTS_DIR / slug
    results_dir.mkdir(parents=True, exist_ok=True)

    passed_count = sum(1 for r in results if r.passed)
    failed_count = sum(1 for r in results if not r.passed and not r.skipped)
    skipped_count = sum(1 for r in results if r.skipped)

    run_data = {
        "project": slug,
        "run_id": run_id,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "total": len(results),
        "passed": passed_count,
        "failed": failed_count,
        "skipped": skipped_count,
        "results": [asdict(r) for r in results],
    }

    result_file = results_dir / f"{run_id}.json"
    with result_file.open("w") as f:
        json.dump(run_data, f, indent=2)

    # Print summary
    print("\n" + "=" * 60)
    print("uwu-tester RESULTS")
    print("=" * 60)
    for r in results:
        icon = "✓" if r.passed else ("~" if r.skipped else "✗")
        status = "PASS" if r.passed else ("SKIP" if r.skipped else "FAIL")
        print(f"  {icon} {r.label:<32} {status}  {r.duration_s:.1f}s")
    print(f"\n{passed_count}/{len(results)} passed  |  {failed_count} failed  |  {skipped_count} skipped")
    print(f"Results: {result_file}")
    print("=" * 60)

    if failed_count > 0:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
