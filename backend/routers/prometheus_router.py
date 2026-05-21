import httpx
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from backend.database import get_db
from backend.models import PrometheusSample
from backend.schemas import PrometheusSampleOut
from backend.services.yaml_io import read_app_settings
from backend.config import settings as env_settings

router = APIRouter(prefix="/api", tags=["prometheus"])


@router.get("/prometheus/test")
async def test_prometheus(url: str | None = None, username: str | None = None, password: str | None = None) -> dict:
    saved = read_app_settings()
    base = url or saved.get("prometheus_url") or env_settings.PROMETHEUS_URL
    user = username if username is not None else (saved.get("prometheus_username") or env_settings.PROMETHEUS_USERNAME)
    pw   = password if password is not None else (saved.get("prometheus_password") or env_settings.PROMETHEUS_PASSWORD)
    auth = (user, pw) if user else None

    # Detect scrape endpoints — these aren't queryable via PromQL
    if any(base.rstrip("/").endswith(s) for s in ["/metrics", "/public_metrics"]):
        return {
            "status": "misconfigured",
            "url": base,
            "detail": "This URL looks like a Prometheus scrape endpoint, not a queryable Prometheus instance.",
            "hint": "The PROMETHEUS_URL should point to a Prometheus server (e.g. http://host:9090), not a /metrics scrape endpoint. Point your Prometheus instance to scrape this URL, then set PROMETHEUS_URL to the Prometheus server.",
        }

    query_url = f"{base.rstrip('/')}/api/v1/query"
    try:
        async with httpx.AsyncClient(timeout=8.0, auth=auth) as client:
            resp = await client.get(query_url, params={"query": "up"})
    except httpx.ConnectError as e:
        return {
            "status": "unreachable",
            "url": base,
            "detail": f"Connection refused or host unreachable: {e}",
            "hint": "Check that PROMETHEUS_URL is correct and port is open. If this is an internal address, make sure the worker can reach it.",
        }
    except httpx.TimeoutException:
        return {
            "status": "timeout",
            "url": base,
            "detail": f"Connection timed out after 8s.",
            "hint": "The host is reachable but not responding. Check the port and any firewall rules.",
        }
    except Exception as e:
        return {
            "status": "error",
            "url": base,
            "detail": str(e),
            "hint": "Unexpected error connecting to Prometheus.",
        }

    if resp.status_code == 401:
        return {
            "status": "auth_failed",
            "url": base,
            "detail": f"HTTP 401 Unauthorized. Server response: {resp.text[:200]}",
            "hint": "Check PROMETHEUS_USERNAME and PROMETHEUS_PASSWORD. If the endpoint uses bearer token auth, basic auth won't work.",
        }
    if resp.status_code == 403:
        return {
            "status": "auth_failed",
            "url": base,
            "detail": f"HTTP 403 Forbidden. Server response: {resp.text[:200]}",
            "hint": "Credentials were accepted but access was denied. Check that this user has read access to Prometheus.",
        }
    if resp.status_code == 404:
        return {
            "status": "misconfigured",
            "url": base,
            "detail": f"HTTP 404 — {query_url} not found.",
            "hint": "This URL doesn't expose the Prometheus query API (/api/v1/query). Make sure PROMETHEUS_URL points to a Prometheus server, not a metrics scrape endpoint.",
        }
    if resp.status_code != 200:
        return {
            "status": "error",
            "url": base,
            "detail": f"HTTP {resp.status_code}: {resp.text[:200]}",
            "hint": "Unexpected response from Prometheus.",
        }

    try:
        data = resp.json()
        result_count = len(data.get("data", {}).get("result", []))
    except Exception:
        return {
            "status": "error",
            "url": base,
            "detail": "Connected but response was not valid JSON.",
            "hint": "The URL may not be a Prometheus instance.",
        }

    return {
        "status": "ok",
        "url": base,
        "detail": f"Connected successfully. {result_count} active targets found.",
        "hint": None,
    }


@router.get("/runs/{run_id}/prometheus", response_model=list[PrometheusSampleOut])
async def get_prometheus_samples(run_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PrometheusSample)
        .where(PrometheusSample.run_id == run_id)
        .order_by(PrometheusSample.t)
    )
    return result.scalars().all()
