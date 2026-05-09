import asyncio
import itertools
import copy
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from backend.database import get_db, SessionLocal
from backend.models import Sweep, Run
from backend.schemas import SweepCreate, SweepOut, SweepDetail
from backend.services.omb_runner import OmbRunner
from backend.services.yaml_io import write_driver, write_workload, read_workload

router = APIRouter(prefix="/api/sweeps", tags=["sweeps"])

_runner: OmbRunner | None = None


def set_runner(r: OmbRunner) -> None:
    global _runner
    _runner = r


def get_runner() -> OmbRunner:
    assert _runner is not None
    return _runner


def _build_driver_config(base_config: dict, params: dict) -> dict:
    config = copy.deepcopy(base_config)
    sub_dicts = ["commonConfig", "producerConfig", "consumerConfig", "topicConfig"]
    for key, value in params.items():
        placed = False
        for sub in sub_dicts:
            if sub in config and key in config[sub]:
                config[sub][key] = value
                placed = True
                break
        if not placed:
            config.setdefault("producerConfig", {})[key] = value
    return config


def _generate_combinations(parameter_axes: dict[str, list[str]]) -> list[dict[str, str]]:
    if not parameter_axes:
        return [{}]
    keys = list(parameter_axes.keys())
    return [dict(zip(keys, combo)) for combo in itertools.product(*parameter_axes.values())]


async def _finish_run(run_id: int, runner: OmbRunner) -> None:
    from backend.routers.runs_router import _finish_run as _fr
    await _fr(run_id, runner)


async def _poll_prometheus(run_id: int, runner: OmbRunner, started_at: datetime) -> None:
    from backend.routers.runs_router import _poll_prometheus as _pp
    await _pp(run_id, runner, started_at)


async def _run_sweep(sweep_id: int, runner: OmbRunner) -> None:
    async with SessionLocal() as db:
        result = await db.execute(
            select(Run)
            .where(Run.sweep_id == sweep_id, Run.status == "pending")
            .order_by(Run.id)
        )
        pending_runs = result.scalars().all()
        run_ids = [r.id for r in pending_runs]

    for run_id in run_ids:
        # Check if sweep was cancelled
        async with SessionLocal() as db:
            sweep = await db.get(Sweep, sweep_id)
            if sweep is None or sweep.status != "running":
                return
            run_obj = await db.get(Run, run_id)
            if run_obj is None or run_obj.status == "cancelled":
                continue
            actual_started_at = datetime.utcnow()
            run_obj.status = "running"
            run_obj.started_at = actual_started_at
            await db.commit()

        try:
            write_driver(run_obj.driver_config)
            write_workload(run_obj.workload_config)
            await runner.start(run_id)
            asyncio.create_task(_finish_run(run_id, runner))
            asyncio.create_task(_poll_prometheus(run_id, runner, actual_started_at))

            while not runner.is_done(run_id):
                await asyncio.sleep(2)

            # Poll DB until _finish_run updates status (max 30s)
            for _ in range(15):
                async with SessionLocal() as db:
                    run_obj = await db.get(Run, run_id)
                    if run_obj and run_obj.status != "running":
                        break
                await asyncio.sleep(2)

            async with SessionLocal() as db:
                run_obj = await db.get(Run, run_id)
                final_status = run_obj.status if run_obj else "failed"

            if final_status in ("failed", "cancelled", "running"):
                continue

            async with SessionLocal() as db:
                sweep = await db.get(Sweep, sweep_id)
                cooldown = sweep.cooldown_seconds if sweep else 60

            await asyncio.sleep(cooldown)

        except Exception:
            continue

    async with SessionLocal() as db:
        sweep_obj = await db.get(Sweep, sweep_id)
        if sweep_obj and sweep_obj.status == "running":
            sweep_obj.status = "completed"
            sweep_obj.completed_at = datetime.utcnow()
            await db.commit()


@router.post("", response_model=SweepOut, status_code=201)
async def create_sweep(
    body: SweepCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> SweepOut:
    sweep = Sweep(
        name=body.name,
        parameter_axes=body.parameter_axes,
        cooldown_seconds=body.cooldown_seconds,
    )
    db.add(sweep)
    await db.flush()

    base_workload = read_workload()
    base_workload.update(body.workload_config)

    for combo in _generate_combinations(body.parameter_axes):
        driver_config = _build_driver_config(body.driver_base_config, combo)
        db.add(Run(
            status="pending",
            sweep_id=sweep.id,
            sweep_params=combo,
            driver_config=driver_config,
            workload_config=base_workload,
        ))

    await db.commit()

    background_tasks.add_task(_run_sweep, sweep.id, get_runner())

    result = await db.execute(
        select(Sweep).options(selectinload(Sweep.runs)).where(Sweep.id == sweep.id)
    )
    return result.scalar_one()


@router.get("", response_model=list[SweepOut])
async def list_sweeps(db: AsyncSession = Depends(get_db)) -> list[SweepOut]:
    result = await db.execute(
        select(Sweep).options(selectinload(Sweep.runs)).order_by(Sweep.id.desc())
    )
    return result.scalars().all()


@router.get("/{sweep_id}", response_model=SweepDetail)
async def get_sweep(sweep_id: int, db: AsyncSession = Depends(get_db)) -> SweepDetail:
    result = await db.execute(
        select(Sweep)
        .options(selectinload(Sweep.runs).selectinload(Run.metrics))
        .where(Sweep.id == sweep_id)
    )
    sweep = result.scalar_one_or_none()
    if sweep is None:
        raise HTTPException(status_code=404, detail="Sweep not found")
    return sweep


@router.delete("/{sweep_id}")
async def cancel_sweep(sweep_id: int, db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(
        select(Sweep).options(selectinload(Sweep.runs)).where(Sweep.id == sweep_id)
    )
    sweep = result.scalar_one_or_none()
    if sweep is None:
        raise HTTPException(status_code=404, detail="Sweep not found")
    if sweep.status != "running":
        raise HTTPException(status_code=400, detail="Sweep is not running")

    runner = get_runner()
    for run in sweep.runs:
        if run.status == "running":
            await runner.stop(run.id)
            run.status = "cancelled"
        elif run.status == "pending":
            run.status = "cancelled"

    sweep.status = "cancelled"
    sweep.completed_at = datetime.utcnow()
    await db.commit()
    return {"status": "cancelled"}
