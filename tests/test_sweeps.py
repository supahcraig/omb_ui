import pytest
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
