import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from backend.database import engine, Base, SessionLocal
from backend.models import Sweep, Run


@pytest.mark.asyncio
async def test_sweep_computed_properties():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        sweep = Sweep(name="test", parameter_axes={"acks": ["0", "1"]}, cooldown_seconds=30)
        db.add(sweep)
        await db.flush()
        db.add(Run(sweep_id=sweep.id, sweep_params={"acks": "0"}, status="completed",
                   driver_config={}, workload_config={"testDurationMinutes": 5, "warmupDurationMinutes": 1}))
        db.add(Run(sweep_id=sweep.id, sweep_params={"acks": "1"}, status="failed",
                   driver_config={}, workload_config={}))
        db.add(Run(sweep_id=sweep.id, sweep_params={"acks": "all"}, status="pending",
                   driver_config={}, workload_config={}))
        await db.commit()

        result = await db.execute(
            select(Sweep).options(__import__("sqlalchemy.orm", fromlist=["selectinload"]).selectinload(Sweep.runs))
            .where(Sweep.id == sweep.id)
        )
        loaded = result.scalar_one()

    assert loaded.run_count == 3
    assert loaded.completed_count == 1
    assert loaded.failed_count == 1
    assert loaded.est_seconds_remaining is not None  # 1 pending run × (6 min + 30 s)

    # cleanup
    async with SessionLocal() as db:
        await db.execute(delete(Run).where(Run.sweep_id == loaded.id))
        await db.execute(delete(Sweep).where(Sweep.id == loaded.id))
        await db.commit()


@pytest.mark.asyncio
async def test_post_sweeps_creates_cartesian_product():
    from backend.main import app
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    body = {
        "name": "acks sweep",
        "parameter_axes": {"acks": ["0", "1", "all"], "linger.ms": ["1", "5"]},
        "cooldown_seconds": 30,
        "workload_config": {"testDurationMinutes": 5, "warmupDurationMinutes": 1},
        "driver_base_config": {"producerConfig": {"acks": "all", "linger.ms": "1"}},
    }

    mock_runner = MagicMock()
    mock_runner.start = AsyncMock()

    with patch("backend.routers.sweeps_router._runner", mock_runner), \
         patch("backend.routers.sweeps_router._run_sweep", new_callable=AsyncMock):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/api/sweeps", json=body)

    assert resp.status_code == 201
    data = resp.json()
    assert data["run_count"] == 6  # 3 acks × 2 linger.ms
    assert data["name"] == "acks sweep"
    assert data["status"] == "running"

    # Verify combinations stored correctly
    async with SessionLocal() as db:
        result = await db.execute(select(Run).where(Run.sweep_id == data["id"]))
        runs = result.scalars().all()
    assert len(runs) == 6
    params = [r.sweep_params for r in runs]
    assert {"acks": "0", "linger.ms": "1"} in params
    assert {"acks": "all", "linger.ms": "5"} in params
    # Verify overlay applied to driver_config
    for r in runs:
        assert r.driver_config["producerConfig"]["acks"] == r.sweep_params["acks"]

    # cleanup
    async with SessionLocal() as db:
        await db.execute(delete(Run).where(Run.sweep_id == data["id"]))
        await db.execute(delete(Sweep).where(Sweep.id == data["id"]))
        await db.commit()


@pytest.mark.asyncio
async def test_get_sweep_detail_returns_runs():
    from backend.main import app
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        sweep = Sweep(name="detail test", parameter_axes={"acks": ["0"]}, cooldown_seconds=60, status="completed")
        db.add(sweep)
        await db.flush()
        db.add(Run(sweep_id=sweep.id, sweep_params={"acks": "0"}, status="completed",
                   driver_config={}, workload_config={}))
        await db.commit()
        sweep_id = sweep.id

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(f"/api/sweeps/{sweep_id}")

    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == sweep_id
    assert len(data["runs"]) == 1
    assert data["runs"][0]["sweep_params"] == {"acks": "0"}

    async with SessionLocal() as db:
        await db.execute(delete(Run).where(Run.sweep_id == sweep_id))
        await db.execute(delete(Sweep).where(Sweep.id == sweep_id))
        await db.commit()


@pytest.mark.asyncio
async def test_delete_sweep_cancels_pending_runs():
    from backend.main import app
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        sweep = Sweep(name="cancel test", parameter_axes={"acks": ["0", "1"]}, cooldown_seconds=60)
        db.add(sweep)
        await db.flush()
        run1 = Run(sweep_id=sweep.id, sweep_params={"acks": "0"}, status="running",
                   driver_config={}, workload_config={})
        run2 = Run(sweep_id=sweep.id, sweep_params={"acks": "1"}, status="pending",
                   driver_config={}, workload_config={})
        db.add(run1)
        db.add(run2)
        await db.commit()
        sweep_id, run1_id, run2_id = sweep.id, run1.id, run2.id

    mock_runner = MagicMock()
    mock_runner.stop = AsyncMock()

    with patch("backend.routers.sweeps_router._runner", mock_runner):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.delete(f"/api/sweeps/{sweep_id}")

    assert resp.status_code == 200
    mock_runner.stop.assert_called_once_with(run1_id)

    async with SessionLocal() as db:
        r1 = await db.get(Run, run1_id)
        r2 = await db.get(Run, run2_id)
        sw = await db.get(Sweep, sweep_id)
    assert r1.status == "cancelled"
    assert r2.status == "cancelled"
    assert sw.status == "cancelled"

    async with SessionLocal() as db:
        await db.execute(delete(Run).where(Run.sweep_id == sweep_id))
        await db.execute(delete(Sweep).where(Sweep.id == sweep_id))
        await db.commit()


@pytest.mark.asyncio
async def test_run_sweep_continues_past_failed_run():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        sweep = Sweep(name="fail test", parameter_axes={"acks": ["0", "1"]}, cooldown_seconds=0)
        db.add(sweep)
        await db.flush()
        run1 = Run(sweep_id=sweep.id, sweep_params={"acks": "0"}, status="pending",
                   driver_config={}, workload_config={})
        run2 = Run(sweep_id=sweep.id, sweep_params={"acks": "1"}, status="pending",
                   driver_config={}, workload_config={})
        db.add(run1)
        db.add(run2)
        await db.commit()
        sweep_id, run1_id, run2_id = sweep.id, run1.id, run2.id

    mock_runner = MagicMock()
    mock_runner.start = AsyncMock()
    mock_runner.stop = AsyncMock()
    mock_runner.is_done = MagicMock(return_value=True)

    async def fake_finish_run(rid, runner):
        async with SessionLocal() as db:
            r = await db.get(Run, rid)
            r.status = "failed"
            r.completed_at = __import__("datetime").datetime.utcnow()
            await db.commit()

    async def fake_poll(rid, runner, started_at):
        pass

    from backend.routers.sweeps_router import _run_sweep
    with patch("backend.routers.sweeps_router._finish_run", side_effect=fake_finish_run), \
         patch("backend.routers.sweeps_router._poll_prometheus", side_effect=fake_poll):
        await _run_sweep(sweep_id, mock_runner)

    async with SessionLocal() as db:
        sw = await db.get(Sweep, sweep_id)
        r1 = await db.get(Run, run1_id)
        r2 = await db.get(Run, run2_id)

    assert sw.status == "completed"
    assert r1.status == "failed"
    assert r2.status == "failed"  # both ran (sweep continued past first failure)
    assert mock_runner.start.call_count == 2

    async with SessionLocal() as db:
        await db.execute(delete(Run).where(Run.sweep_id == sweep_id))
        await db.execute(delete(Sweep).where(Sweep.id == sweep_id))
        await db.commit()
