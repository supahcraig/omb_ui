import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from backend.database import engine, Base
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
