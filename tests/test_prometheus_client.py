import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from backend.services.prometheus_client import query_batch_size, query_bytes_in, query_bytes_out


def _mock_httpx_client(response_json):
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json.return_value = response_json
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=resp)
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=mock_client)
    ctx.__aexit__ = AsyncMock(return_value=None)
    return ctx


@pytest.mark.asyncio
async def test_query_batch_size_normal():
    payload = {"data": {"result": [{"value": [0, "131072.0"]}]}}
    with patch("httpx.AsyncClient", return_value=_mock_httpx_client(payload)):
        result = await query_batch_size("http://localhost:9644")
    assert result == pytest.approx(131072.0)


@pytest.mark.asyncio
async def test_query_returns_none_on_empty_result():
    payload = {"data": {"result": []}}
    with patch("httpx.AsyncClient", return_value=_mock_httpx_client(payload)):
        result = await query_bytes_in("http://localhost:9644")
    assert result is None


@pytest.mark.asyncio
async def test_query_returns_none_on_connection_error():
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(side_effect=Exception("connection refused"))
    ctx.__aexit__ = AsyncMock(return_value=None)
    with patch("httpx.AsyncClient", return_value=ctx):
        result = await query_bytes_out("http://localhost:9644")
    assert result is None


@pytest.mark.asyncio
async def test_query_returns_none_on_nan():
    payload = {"data": {"result": [{"value": [0, "nan"]}]}}
    with patch("httpx.AsyncClient", return_value=_mock_httpx_client(payload)):
        result = await query_batch_size("http://localhost:9644")
    assert result is None
