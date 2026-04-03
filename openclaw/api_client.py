"""
API client for OpenClaw agent to interact with the scheduler dashboard API.
Enables self-management capabilities - agent can create, update, and delete tasks.
"""
from __future__ import annotations

import os
import logging
from typing import Any

import httpx

DEFAULT_BASE_URL = "http://localhost:3000"
TIMEOUT = 30.0
MAX_RETRIES = 3

log = logging.getLogger(__name__)


class SchedulerApiError(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


class SchedulerClient:
    def __init__(self, base_url: str | None = None, api_key: str | None = None):
        self.base_url = (base_url or os.environ.get("DASHBOARD_URL") or DEFAULT_BASE_URL).rstrip("/")
        self.api_key = api_key or os.environ.get("SCHEDULER_API_KEY", "")
        self._client = httpx.Client(
            timeout=TIMEOUT,
            headers=self._build_headers(),
        )

    def _build_headers(self) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _request(
        self,
        method: str,
        path: str,
        data: dict[str, Any] | None = None,
        retries: int = MAX_RETRIES,
    ) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        last_error: Exception | None = None

        for attempt in range(retries):
            try:
                response = self._client.request(method, url, json=data)
                if response.status_code >= 400:
                    log.error(f"API {method} {url} failed with {response.status_code}: {response.text}")
                    if attempt == retries - 1:
                        raise SchedulerApiError(
                            f"API request failed: {response.text}",
                            status_code=response.status_code,
                        )
                elif response.status_code >= 300:
                    log.warning(f"API {method} {url} returned redirect {response.status_code}")
                    if attempt == retries - 1:
                        raise SchedulerApiError(
                            f"Unexpected redirect: {response.status_code}",
                            status_code=response.status_code,
                        )
                else:
                    if response.content:
                        return response.json()
                    return {}
            except httpx.TimeoutException as e:
                log.warning(f"API {method} {url} timeout (attempt {attempt + 1}/{retries})")
                last_error = e
            except httpx.ConnectError as e:
                log.warning(f"API {method} {url} connection error (attempt {attempt + 1}/{retries}): {e}")
                last_error = e
            except httpx.HTTPError as e:
                log.error(f"API {method} {url} HTTP error (attempt {attempt + 1}/{retries}): {e}")
                last_error = e

            if attempt < retries - 1:
                import time
                time.sleep(1 * (attempt + 1))

        raise SchedulerApiError(f"API request failed after {retries} retries: {last_error}")

    def get_tasks(self) -> list[dict[str, Any]]:
        log.info(f"GET /api/scheduler/tasks")
        result = self._request("GET", "/api/scheduler/tasks")
        return result.get("tasks", [])

    def get_task(self, task_id: str) -> dict[str, Any] | None:
        log.info(f"GET /api/scheduler/tasks/{task_id}")
        try:
            result = self._request("GET", f"/api/scheduler/tasks/{task_id}")
            return result.get("task")
        except SchedulerApiError as e:
            if e.status_code == 404:
                return None
            raise

    def create_task(self, task_data: dict[str, Any]) -> dict[str, Any]:
        log.info(f"POST /api/scheduler/tasks: {task_data.get('title', task_data.get('description', ''))[:50]}")
        result = self._request("POST", "/api/scheduler/tasks", data=task_data)
        return result.get("task", {})

    def update_task(self, task_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        log.info(f"PATCH /api/scheduler/tasks/{task_id}: {patch}")
        result = self._request("PATCH", f"/api/scheduler/tasks/{task_id}", data=patch)
        return result.get("task", {})

    def delete_task(self, task_id: str) -> dict[str, Any] | None:
        log.info(f"DELETE /api/scheduler/tasks/{task_id}")
        try:
            result = self._request("DELETE", f"/api/scheduler/tasks/{task_id}")
            return result.get("task")
        except SchedulerApiError as e:
            if e.status_code == 404:
                return None
            raise

    def queue_task_now(self, task_id: str) -> dict[str, Any]:
        log.info(f"PATCH /api/scheduler/tasks/{task_id} action=queue_now")
        return self.update_task(task_id, {"action": "queue_now"})

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "SchedulerClient":
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.close()


_api_client: SchedulerClient | None = None


def get_api_client() -> SchedulerClient:
    global _api_client
    if _api_client is None:
        _api_client = SchedulerClient()
    return _api_client
