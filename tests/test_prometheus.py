import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from backend.database import engine, Base, SessionLocal
from backend.models import PrometheusSample

@pytest.mark.asyncio
async def test_prometheus_sample_round_trip():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with AsyncSession(engine, expire_on_commit=False) as session:
        # Clean up any previous test data
        await session.execute(delete(PrometheusSample).where(PrometheusSample.run_id == 9001))
        await session.commit()

        session.add(PrometheusSample(
            run_id=9001, t=30,
            batch_size_bytes=131072.0,
            bytes_in_per_sec=10485760.0,
            bytes_out_per_sec=3495253.0,
        ))
        await session.commit()
        result = await session.execute(
            select(PrometheusSample).where(PrometheusSample.run_id == 9001)
        )
        sample = result.scalar_one()
    assert sample.t == 30
    assert sample.batch_size_bytes == 131072.0
    assert sample.bytes_in_per_sec == 10485760.0


@pytest.mark.asyncio
async def test_prometheus_endpoint_returns_samples():
    from backend.main import app
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with SessionLocal() as session:
        await session.execute(delete(PrometheusSample).where(PrometheusSample.run_id == 9002))
        await session.commit()
        session.add(PrometheusSample(
            run_id=9002, t=10, batch_size_bytes=65536.0,
            bytes_in_per_sec=5242880.0, bytes_out_per_sec=1747626.0,
        ))
        session.add(PrometheusSample(
            run_id=9002, t=20, batch_size_bytes=131072.0,
            bytes_in_per_sec=10485760.0, bytes_out_per_sec=3495253.0,
        ))
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/runs/9002/prometheus")

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert data[0]["t"] == 10
    assert data[1]["batch_size_bytes"] == pytest.approx(131072.0)


@pytest.mark.asyncio
async def test_prometheus_endpoint_returns_empty_list_for_unknown_run():
    from backend.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/runs/99999/prometheus")
    assert resp.status_code == 200
    assert resp.json() == []


from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_poll_prometheus_writes_final_sample():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with SessionLocal() as session:
        await session.execute(delete(PrometheusSample).where(PrometheusSample.run_id == 9003))
        await session.commit()

    mock_runner = MagicMock()
    mock_runner.is_done.return_value = True  # already done — skip loop, just final poll

    with patch("backend.routers.runs_router.query_batch_size", AsyncMock(return_value=131072.0)), \
         patch("backend.routers.runs_router.query_bytes_in", AsyncMock(return_value=10485760.0)), \
         patch("backend.routers.runs_router.query_bytes_out", AsyncMock(return_value=3145728.0)):
        from backend.routers.runs_router import _poll_prometheus
        await _poll_prometheus(
            run_id=9003,
            runner=mock_runner,
            started_at=datetime.utcnow(),
        )

    async with SessionLocal() as session:
        result = await session.execute(
            select(PrometheusSample).where(PrometheusSample.run_id == 9003)
        )
        samples = result.scalars().all()

    assert len(samples) == 1
    assert samples[0].batch_size_bytes == pytest.approx(131072.0)
    assert samples[0].bytes_in_per_sec == pytest.approx(10485760.0)
    assert samples[0].bytes_out_per_sec == pytest.approx(3145728.0)
