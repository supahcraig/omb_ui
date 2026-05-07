from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from backend.database import get_db
from backend.models import PrometheusSample
from backend.schemas import PrometheusSampleOut

router = APIRouter(prefix="/api/runs", tags=["prometheus"])


@router.get("/{run_id}/prometheus", response_model=list[PrometheusSampleOut])
async def get_prometheus_samples(run_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PrometheusSample)
        .where(PrometheusSample.run_id == run_id)
        .order_by(PrometheusSample.t)
    )
    return result.scalars().all()
