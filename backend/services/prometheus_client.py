import httpx
from backend.config import settings


async def _instant_query(url: str | None, query: str) -> float | None:
    try:
        base = url or settings.PROMETHEUS_URL
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{base}/api/v1/query", params={"query": query})
            resp.raise_for_status()
            results = resp.json()["data"]["result"]
            if not results:
                return None
            value = float(results[0]["value"][1])
            if value != value:  # NaN check
                return None
            return value
    except Exception:
        return None


async def query_batch_size(url: str | None = None) -> float | None:
    return await _instant_query(
        url,
        "sum(irate(vectorized_storage_log_written_bytes[30s])) / "
        "sum(irate(vectorized_storage_log_batches_written[30s]))",
    )


async def query_bytes_in(url: str | None = None) -> float | None:
    return await _instant_query(url, "sum(irate(redpanda_rpc_received_bytes[30s]))")


async def query_bytes_out(url: str | None = None) -> float | None:
    return await _instant_query(url, "sum(irate(redpanda_rpc_sent_bytes[30s]))")
