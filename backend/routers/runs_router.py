import asyncio
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from backend.database import get_db, SessionLocal
from backend.models import Run, Metrics, PrometheusSample
from backend.schemas import RunCreate, RunOut, RunListItem
from backend.services.yaml_io import read_driver, read_workload
from backend.services.result_parser import parse_result_file
from backend.services.omb_runner import OmbRunner
from backend.services.prometheus_client import query_bytes_in, query_bytes_out

router = APIRouter(prefix="/api/runs", tags=["runs"])

# Runner instance injected via dependency; set in main.py
_runner: OmbRunner | None = None

def set_runner(r: OmbRunner):
    global _runner
    _runner = r

def get_runner() -> OmbRunner:
    assert _runner is not None
    return _runner


async def _finish_run(run_id: int, runner: OmbRunner) -> None:
    """Background task: poll until OMB exits, then parse results and update DB."""
    while not runner.is_done(run_id):
        await asyncio.sleep(2)

    async with SessionLocal() as db:
        run = await db.get(Run, run_id)
        if run is None:
            return

        result_file = runner.get_result_file(run_id)
        returncode = runner.get_returncode(run_id)

        if run.status == "running":
            if result_file and returncode == 0:
                try:
                    metrics_data = parse_result_file(result_file)
                    db.add(Metrics(run_id=run_id, **metrics_data))
                    run.status = "completed"
                except Exception:
                    run.status = "failed"
            else:
                run.status = "failed"

        if run.completed_at is None:
            run.completed_at = datetime.utcnow()
        await db.commit()


async def _poll_prometheus(run_id: int, runner: OmbRunner, started_at: datetime) -> None:
    """Background task: poll Prometheus every 10 s while the run is active."""
    import logging
    log = logging.getLogger("omb_ui.prometheus")
    while not runner.is_done(run_id):
        try:
            t = int((datetime.utcnow() - started_at).total_seconds())
            b_in, b_out = await asyncio.gather(
                query_bytes_in(),
                query_bytes_out(),
            )
            if b_in is None and b_out is None:
                log.warning("run %d: all Prometheus queries returned None at t=%ds — check PROMETHEUS_URL/credentials", run_id, t)
            async with SessionLocal() as db:
                db.add(PrometheusSample(
                    run_id=run_id, t=t,
                    bytes_in_per_sec=b_in,
                    bytes_out_per_sec=b_out,
                ))
                await db.commit()
        except Exception as e:
            log.error("run %d: Prometheus polling error: %s", run_id, e)
        await asyncio.sleep(10)

    # One final sample captured after the run ends
    try:
        t = int((datetime.utcnow() - started_at).total_seconds())
        b_in, b_out = await asyncio.gather(
            query_bytes_in(),
            query_bytes_out(),
        )
        async with SessionLocal() as db:
            db.add(PrometheusSample(
                run_id=run_id, t=t,
                bytes_in_per_sec=b_in,
                bytes_out_per_sec=b_out,
            ))
            await db.commit()
    except Exception:
        pass


@router.get("", response_model=list[RunListItem])
async def list_runs(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Run).options(selectinload(Run.metrics)).order_by(Run.started_at.desc())
    )
    runs = result.scalars().all()
    items = []
    for r in runs:
        items.append(RunListItem(
            id=r.id, name=r.name, status=r.status,
            started_at=r.started_at, completed_at=r.completed_at,
            sweep_id=r.sweep_id,
            publish_rate_avg=r.metrics.publish_rate_avg if r.metrics else None,
            publish_latency_p99=r.metrics.publish_latency_p99 if r.metrics else None,
            publish_latency_p999=r.metrics.publish_latency_p999 if r.metrics else None,
            end_to_end_latency_p99=r.metrics.end_to_end_latency_p99 if r.metrics else None,
        ))
    return items


@router.post("", response_model=RunOut, status_code=201)
async def create_run(
    body: RunCreate,
    db: AsyncSession = Depends(get_db),
    runner: OmbRunner = Depends(get_runner),
):
    driver = read_driver()
    workload = read_workload()
    run = Run(name=body.name, status="running", driver_config=driver, workload_config=workload)
    db.add(run)
    await db.commit()
    await db.refresh(run)

    await runner.start(run.id)
    asyncio.create_task(_finish_run(run.id, runner))
    asyncio.create_task(_poll_prometheus(run.id, runner, run.started_at))

    # Re-fetch with selectinload so Pydantic can access the metrics relationship
    # without triggering a lazy-load outside the async session greenlet.
    result = await db.execute(
        select(Run).where(Run.id == run.id).options(selectinload(Run.metrics))
    )
    run = result.scalar_one()
    return RunOut.model_validate(run)


@router.get("/{run_id}", response_model=RunOut)
async def get_run(run_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Run).where(Run.id == run_id).options(selectinload(Run.metrics))
    )
    run = result.scalar_one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return RunOut.model_validate(run)


@router.delete("/{run_id}", status_code=204)
async def stop_run(
    run_id: int,
    db: AsyncSession = Depends(get_db),
    runner: OmbRunner = Depends(get_runner),
):
    run = await db.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status == "running":
        await runner.stop(run_id)
        run.status = "failed"
        run.completed_at = datetime.utcnow()
        await db.commit()
