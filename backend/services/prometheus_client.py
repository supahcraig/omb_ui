import math

import httpx
from backend.config import settings
from backend.services.yaml_io import read_app_settings


async def _instant_query(url: str | None, query: str) -> float | None:
    try:
        saved = read_app_settings()
        base = url or saved.get("prometheus_url") or settings.PROMETHEUS_URL
        username = saved.get("prometheus_username", "")
        password = saved.get("prometheus_password", "")
        auth = (username, password) if username else None
        async with httpx.AsyncClient(timeout=5.0, auth=auth) as client:
            resp = await client.get(f"{base}/api/v1/query", params={"query": query})
            resp.raise_for_status()
            results = resp.json()["data"]["result"]
            if not results:
                return None
            value = float(results[0]["value"][1])
            if not math.isfinite(value):
                return None
            return value
    except Exception:
        return None


async def query_bytes_in(url: str | None = None) -> float | None:
    return await _instant_query(url, "sum(irate(redpanda_rpc_received_bytes[30s]))")


async def query_bytes_out(url: str | None = None) -> float | None:
    return await _instant_query(url, "sum(irate(redpanda_rpc_sent_bytes[30s]))")
