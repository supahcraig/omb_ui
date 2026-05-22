import logging
import math

import httpx
from backend.config import settings
from backend.services.yaml_io import read_app_settings

log = logging.getLogger("omb_ui.prometheus")

BYTES_WRITTEN  = "vectorized_storage_log_written_bytes"
BATCHES_WRITTEN = "vectorized_storage_log_batches_written"


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
                log.debug("Prometheus query returned no results: %s", query)
                return None
            value = float(results[0]["value"][1])
            if not math.isfinite(value):
                log.debug("Prometheus query returned non-finite value %s: %s", value, query)
                return None
            return value
    except Exception as exc:
        log.debug("Prometheus query failed (%s): %s", exc, query)
        return None


async def query_batch_size(url: str | None = None) -> float | None:
    # Query both sides separately so failures are identifiable in logs
    written = await _instant_query(
        url,
        f"sum(irate({BYTES_WRITTEN}{{topic!~\"^_.*\"}}[5m]))",
    )
    batches = await _instant_query(
        url,
        f"sum(irate({BATCHES_WRITTEN}{{topic!~\"^_.*\"}}[5m]))",
    )
    log.warning("batch_size components: written=%s batches=%s", written, batches)
    if written is None or batches is None or batches == 0:
        return None
    return written / batches


async def query_bytes_in(url: str | None = None) -> float | None:
    return await _instant_query(url, "sum(irate(redpanda_rpc_received_bytes[30s]))")


async def query_bytes_out(url: str | None = None) -> float | None:
    return await _instant_query(url, "sum(irate(redpanda_rpc_sent_bytes[30s]))")
