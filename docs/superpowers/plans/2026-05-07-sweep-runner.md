# Sweep Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sweep runner that executes a Cartesian-product parameter sweep over driver config params, with configurable cooldown between runs, and a comparison table showing best/worst results per metric.

**Architecture:** A new `Sweep` DB model holds parameter axes and execution state. `Run` rows are pre-generated (status=`pending`) when the sweep is created, then a `_run_sweep` background coroutine executes them sequentially, reusing `_finish_run` and `_poll_prometheus` from `runs_router`. Three new frontend pages (list, new, detail) and a badge on the Results page.

**Tech Stack:** SQLAlchemy 2.x async, Pydantic v2, FastAPI BackgroundTasks, asyncio, React + TanStack Query v5, Recharts patterns from RunDetail, React Router v6.

---

## File Map

| File | Change |
|------|--------|
| `backend/models.py` | Add `Sweep` model; add `sweep_params` column to `Run` |
| `backend/schemas.py` | Add `SweepCreate`, `SweepOut`, `SweepDetail`; add `sweep_params` to `RunOut`; add `sweep_id` + `est_seconds_remaining` fields |
| `backend/routers/sweeps_router.py` | **New** — CRUD endpoints + `_run_sweep` coroutine |
| `backend/main.py` | Import and register `sweeps_router`; call `sweeps_router.set_runner` |
| `tests/test_sweeps.py` | **New** — 5 tests covering product generation, create, detail, cancel, failure recovery |
| `frontend/src/api/types.ts` | Add `Sweep`, `SweepDetail`, `SweepCreatePayload`; update `Run` (add `sweep_params`); update `RunListItem` (add `sweep_id`) |
| `frontend/src/api/client.ts` | Add `listSweeps`, `getSweep`, `createSweep`, `cancelSweep` |
| `frontend/src/components/Sidebar.tsx` | Remove `disabled: true` from Sweeps entry |
| `frontend/src/App.tsx` | Add `/sweeps`, `/sweeps/new`, `/sweeps/:id` routes |
| `frontend/src/pages/Sweeps/index.tsx` | **New** — Sweeps list page |
| `frontend/src/pages/Sweeps/NewSweep.tsx` | **New** — New Sweep form |
| `frontend/src/pages/Sweeps/SweepDetail.tsx` | **New** — Sweep detail + comparison table |
| `frontend/src/pages/Results/RunTable.tsx` | Add sweep badge to run rows |

---

## Task 1: DB Models + Schemas

**Files:**
- Modify: `backend/models.py`
- Modify: `backend/schemas.py`

### Background

The `runs` table already has `sweep_id: Mapped[int | None]` with no FK constraint. We're adding `sweep_params` (the specific parameter combination for this run). The `Sweep` model uses `@property` for computed counts (`run_count`, `completed_count`, `failed_count`, `est_seconds_remaining`) which Pydantic v2 reads via `getattr()` when `from_attributes=True`. Because SQLite's `create_all` is non-destructive and won't add the new `sweep_params` column to the existing `runs` table, **the DB must be deleted before running** (handled in the step below).

- [ ] **Step 1: Reset the database**

```bash
rm -f ./omb_ui.db
```

Expected: file removed.

- [ ] **Step 2: Write the failing model test**

Create `tests/test_sweeps.py`:

```python
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
```

- [ ] **Step 3: Run to verify it fails**

```bash
cd /Users/cnelson/sandbox/omb_ui && python -m pytest tests/test_sweeps.py::test_sweep_computed_properties -v
```

Expected: `ImportError` or `AttributeError` — `Sweep` doesn't exist yet.

- [ ] **Step 4: Add `Sweep` model and `sweep_params` column to `Run`**

Edit `backend/models.py` — add `sweep_params` to `Run`, and add the full `Sweep` class after `PrometheusSample`:

```python
from datetime import datetime
from sqlalchemy import Integer, String, Float, DateTime, ForeignKey, JSON, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.database import Base

class Run(Base):
    __tablename__ = "runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="pending")  # pending|running|completed|failed|cancelled
    started_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    driver_config: Mapped[dict] = mapped_column(JSON)
    workload_config: Mapped[dict] = mapped_column(JSON)
    sweep_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sweep_params: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    metrics: Mapped["Metrics | None"] = relationship("Metrics", back_populates="run", uselist=False, cascade="all, delete-orphan")

class Metrics(Base):
    __tablename__ = "metrics"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(Integer, ForeignKey("runs.id"), unique=True)
    publish_rate_avg: Mapped[float | None] = mapped_column(Float, nullable=True)
    publish_latency_avg: Mapped[float | None] = mapped_column(Float, nullable=True)
    publish_latency_p50: Mapped[float | None] = mapped_column(Float, nullable=True)
    publish_latency_p75: Mapped[float | None] = mapped_column(Float, nullable=True)
    publish_latency_p95: Mapped[float | None] = mapped_column(Float, nullable=True)
    publish_latency_p99: Mapped[float | None] = mapped_column(Float, nullable=True)
    publish_latency_p999: Mapped[float | None] = mapped_column(Float, nullable=True)
    publish_latency_p9999: Mapped[float | None] = mapped_column(Float, nullable=True)
    publish_latency_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_to_end_latency_avg: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_to_end_latency_p50: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_to_end_latency_p75: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_to_end_latency_p95: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_to_end_latency_p99: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_to_end_latency_p999: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_to_end_latency_p9999: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_to_end_latency_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    consume_rate_avg: Mapped[float | None] = mapped_column(Float, nullable=True)
    backlog_avg: Mapped[float | None] = mapped_column(Float, nullable=True)
    throughput_timeseries: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    run: Mapped["Run"] = relationship("Run", back_populates="metrics")

class PrometheusSample(Base):
    __tablename__ = "prometheus_samples"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(Integer, ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    t: Mapped[int] = mapped_column(Integer)
    batch_size_bytes: Mapped[float | None] = mapped_column(Float, nullable=True)
    bytes_in_per_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
    bytes_out_per_sec: Mapped[float | None] = mapped_column(Float, nullable=True)

class Sweep(Base):
    __tablename__ = "sweeps"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="running")
    parameter_axes: Mapped[dict] = mapped_column(JSON)
    cooldown_seconds: Mapped[int] = mapped_column(Integer, default=60)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    runs: Mapped[list["Run"]] = relationship(
        "Run",
        foreign_keys="[Run.sweep_id]",
        primaryjoin="Run.sweep_id == Sweep.id",
    )

    @property
    def run_count(self) -> int:
        return len(self.runs)

    @property
    def completed_count(self) -> int:
        return sum(1 for r in self.runs if r.status == "completed")

    @property
    def failed_count(self) -> int:
        return sum(1 for r in self.runs if r.status in ("failed", "cancelled"))

    @property
    def est_seconds_remaining(self) -> int | None:
        if self.status != "running":
            return None
        pending = [r for r in self.runs if r.status == "pending"]
        if not pending:
            return None
        wc = pending[0].workload_config or {}
        run_minutes = wc.get("testDurationMinutes", 20) + wc.get("warmupDurationMinutes", 5)
        return len(pending) * (run_minutes * 60 + self.cooldown_seconds)
```

- [ ] **Step 5: Update schemas**

Edit `backend/schemas.py` — add `sweep_params` to `RunOut`, add `sweep_id` to `RunListItem`, and append the sweep schemas at the end:

```python
from datetime import datetime
from pydantic import BaseModel


# --- Config ---

class DriverConfig(BaseModel):
    driverClass: str = "io.openmessaging.benchmark.driver.redpanda.RedpandaBenchmarkDriver"
    replicationFactor: int = 3
    reset: bool = True
    topicConfig: dict[str, str] = {}
    commonConfig: dict[str, str] = {}
    producerConfig: dict[str, str] = {}
    consumerConfig: dict[str, str] = {}


class WorkloadConfig(BaseModel):
    topics: int = 1
    partitionsPerTopic: int = 10
    messageSize: int = 1024
    payloadFile: str = "payload/payload-1Kb.data"
    subscriptionsPerTopic: int = 1
    consumerPerSubscription: int = 1
    producersPerTopic: int = 10
    producerRate: int = 10000
    consumerBacklogSizeGB: int = 0
    testDurationMinutes: int = 20
    warmupDurationMinutes: int = 5
    keyDistributor: str | None = None


class ConfigPayload(BaseModel):
    driver: DriverConfig
    workload: WorkloadConfig


# --- Runs ---

class RunCreate(BaseModel):
    name: str | None = None


class MetricsOut(BaseModel):
    publish_rate_avg: float | None
    publish_latency_avg: float | None
    publish_latency_p50: float | None
    publish_latency_p75: float | None
    publish_latency_p95: float | None
    publish_latency_p99: float | None
    publish_latency_p999: float | None
    publish_latency_p9999: float | None
    publish_latency_max: float | None
    end_to_end_latency_avg: float | None
    end_to_end_latency_p50: float | None
    end_to_end_latency_p75: float | None
    end_to_end_latency_p95: float | None
    end_to_end_latency_p99: float | None
    end_to_end_latency_p999: float | None
    end_to_end_latency_p9999: float | None
    end_to_end_latency_max: float | None
    consume_rate_avg: float | None
    backlog_avg: float | None
    throughput_timeseries: dict | None

    model_config = {"from_attributes": True}


class RunOut(BaseModel):
    id: int
    name: str | None
    status: str
    started_at: datetime
    completed_at: datetime | None
    driver_config: dict
    workload_config: dict
    sweep_id: int | None
    sweep_params: dict | None
    metrics: MetricsOut | None

    model_config = {"from_attributes": True}


class RunListItem(BaseModel):
    id: int
    name: str | None
    status: str
    started_at: datetime
    completed_at: datetime | None
    publish_rate_avg: float | None = None
    publish_latency_p99: float | None = None
    publish_latency_p999: float | None = None
    end_to_end_latency_p99: float | None = None
    sweep_id: int | None = None

    model_config = {"from_attributes": True}


class PrometheusSampleOut(BaseModel):
    t: int
    batch_size_bytes: float | None
    bytes_in_per_sec: float | None
    bytes_out_per_sec: float | None
    model_config = {"from_attributes": True}


# --- Sweeps ---

class SweepCreate(BaseModel):
    name: str
    parameter_axes: dict[str, list[str]]
    cooldown_seconds: int = 60
    workload_config: dict = {}
    driver_base_config: dict = {}


class SweepOut(BaseModel):
    id: int
    name: str
    status: str
    parameter_axes: dict[str, list[str]]
    cooldown_seconds: int
    started_at: datetime
    completed_at: datetime | None
    run_count: int
    completed_count: int
    failed_count: int
    est_seconds_remaining: int | None

    model_config = {"from_attributes": True}


class SweepDetail(SweepOut):
    runs: list[RunOut]
```

- [ ] **Step 6: Run the model test to verify it passes**

```bash
cd /Users/cnelson/sandbox/omb_ui && python -m pytest tests/test_sweeps.py::test_sweep_computed_properties -v
```

Expected: `PASSED`.

- [ ] **Step 7: Verify existing tests still pass**

```bash
cd /Users/cnelson/sandbox/omb_ui && python -m pytest tests/ -v --ignore=tests/test_sweeps.py
```

Expected: all green (except any pre-existing failures unrelated to this change).

- [ ] **Step 8: Commit**

```bash
cd /Users/cnelson/sandbox/omb_ui && git add backend/models.py backend/schemas.py tests/test_sweeps.py && git commit -m "feat: add Sweep model, Run.sweep_params, and sweep schemas"
```

---

## Task 2: Sweeps Router + Backend Tests

**Files:**
- Create: `backend/routers/sweeps_router.py`
- Modify: `backend/main.py`
- Modify: `tests/test_sweeps.py`

### Background

`_run_sweep` is a background coroutine that:
1. Iterates pending runs (ordered by id)
2. Sets run.status = "running", run.started_at = now, calls `runner.start(run_id)`
3. Spawns `_finish_run` and `_poll_prometheus` as concurrent asyncio tasks
4. Waits for `runner.is_done()`, then polls DB until status leaves "running" (max 30s, 15 × 2s)
5. Sleeps `cooldown_seconds` after successful runs; skips cooldown after failed/cancelled
6. At loop end, sets sweep.status = "completed" (only if not already "failed" from cancel)

`_build_driver_config` overlays swept params (flat key-value) into the appropriate nested sub-dict of the driver config. It searches `commonConfig`, `producerConfig`, `consumerConfig`, `topicConfig` in order; if the key is already present somewhere, it updates in place. If not found, it defaults to `producerConfig`.

The cancel endpoint stops the currently running run via `runner.stop(run_id)`, marks remaining pending runs as `cancelled`, and sets sweep.status = "failed".

- [ ] **Step 1: Add the remaining backend tests**

Append to `tests/test_sweeps.py`:

```python
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient, ASGITransport


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
         patch("backend.routers.sweeps_router._run_sweep", new_callable=lambda: lambda *a, **kw: asyncio.sleep(0)):
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
        r2 = await db.get(Run, run2_id)
        sw = await db.get(Sweep, sweep_id)
    assert r2.status == "cancelled"
    assert sw.status == "failed"

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
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
cd /Users/cnelson/sandbox/omb_ui && python -m pytest tests/test_sweeps.py -v -k "not test_sweep_computed_properties"
```

Expected: `ImportError` — `sweeps_router` doesn't exist yet.

- [ ] **Step 3: Create `backend/routers/sweeps_router.py`**

```python
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

            if final_status in ("failed", "cancelled"):
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

    for combo in _generate_combinations(body.parameter_axes):
        driver_config = _build_driver_config(body.driver_base_config, combo)
        db.add(Run(
            status="pending",
            sweep_id=sweep.id,
            sweep_params=combo,
            driver_config=driver_config,
            workload_config=body.workload_config,
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
        elif run.status == "pending":
            run.status = "cancelled"

    sweep.status = "failed"
    sweep.completed_at = datetime.utcnow()
    await db.commit()
    return {"status": "cancelled"}
```

- [ ] **Step 4: Register the sweeps router in `backend/main.py`**

```python
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from backend.database import init_db
from backend.services.omb_runner import OmbRunner
from backend.routers import config_router, runs_router, ws_router, prometheus_router, sweeps_router

STATIC_DIR = Path(__file__).parent.parent / "frontend" / "dist"

runner_instance = OmbRunner()

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    runs_router.set_runner(runner_instance)
    sweeps_router.set_runner(runner_instance)
    yield

app = FastAPI(title="OMB UI", lifespan=lifespan)

app.include_router(config_router.router)
app.include_router(runs_router.router)
app.include_router(ws_router.router)
app.include_router(prometheus_router.router)
app.include_router(sweeps_router.router)

# Serve React SPA — must come after API routes
if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        return FileResponse(str(STATIC_DIR / "index.html"))
```

- [ ] **Step 5: Run all sweep tests**

```bash
cd /Users/cnelson/sandbox/omb_ui && python -m pytest tests/test_sweeps.py -v
```

Expected: all 5 tests `PASSED`.

- [ ] **Step 6: Run full test suite**

```bash
cd /Users/cnelson/sandbox/omb_ui && python -m pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/cnelson/sandbox/omb_ui && git add backend/routers/sweeps_router.py backend/main.py tests/test_sweeps.py && git commit -m "feat: add sweeps router, _run_sweep coroutine, and backend tests"
```

---

## Task 3: Frontend Types + API + Routing

**Files:**
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Update `frontend/src/api/types.ts`**

Add sweep types and update `Run` and `RunListItem`:

```typescript
export interface DriverConfig {
  driverClass: string
  replicationFactor: number
  reset: boolean
  topicConfig: Record<string, string>
  commonConfig: Record<string, string>
  producerConfig: Record<string, string>
  consumerConfig: Record<string, string>
}

export interface WorkloadConfig {
  topics: number
  partitionsPerTopic: number
  messageSize: number
  payloadFile: string
  subscriptionsPerTopic: number
  consumerPerSubscription: number
  producersPerTopic: number
  producerRate: number
  consumerBacklogSizeGB: number
  testDurationMinutes: number
  warmupDurationMinutes: number
  keyDistributor?: string
}

export interface ConfigPayload {
  driver: DriverConfig
  workload: WorkloadConfig
}

export interface Metrics {
  publish_rate_avg: number | null
  publish_latency_avg: number | null
  publish_latency_p50: number | null
  publish_latency_p75: number | null
  publish_latency_p95: number | null
  publish_latency_p99: number | null
  publish_latency_p999: number | null
  publish_latency_p9999: number | null
  publish_latency_max: number | null
  end_to_end_latency_avg: number | null
  end_to_end_latency_p50: number | null
  end_to_end_latency_p75: number | null
  end_to_end_latency_p95: number | null
  end_to_end_latency_p99: number | null
  end_to_end_latency_p999: number | null
  end_to_end_latency_p9999: number | null
  end_to_end_latency_max: number | null
  consume_rate_avg: number | null
  backlog_avg: number | null
  throughput_timeseries: {
    publish_rate: number[]
    consume_rate: number[]
    sample_rate_ms: number
  } | null
}

export interface Run {
  id: number
  name: string | null
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  started_at: string
  completed_at: string | null
  driver_config: DriverConfig
  workload_config: WorkloadConfig
  sweep_id: number | null
  sweep_params: Record<string, string> | null
  metrics: Metrics | null
}

export interface RunListItem {
  id: number
  name: string | null
  status: string
  started_at: string
  completed_at: string | null
  publish_rate_avg: number | null
  publish_latency_p99: number | null
  publish_latency_p999: number | null
  end_to_end_latency_p99: number | null
  sweep_id: number | null
}

export interface PrometheusSample {
  t: number
  batch_size_bytes: number | null
  bytes_in_per_sec: number | null
  bytes_out_per_sec: number | null
}

export interface Sweep {
  id: number
  name: string
  status: 'running' | 'completed' | 'failed'
  parameter_axes: Record<string, string[]>
  cooldown_seconds: number
  started_at: string
  completed_at: string | null
  run_count: number
  completed_count: number
  failed_count: number
  est_seconds_remaining: number | null
}

export interface SweepDetail extends Sweep {
  runs: Run[]
}

export interface SweepCreatePayload {
  name: string
  parameter_axes: Record<string, string[]>
  cooldown_seconds: number
  workload_config: Record<string, unknown>
  driver_base_config: Record<string, unknown>
}
```

- [ ] **Step 2: Update `frontend/src/api/client.ts`**

```typescript
import type { ConfigPayload, Run, RunListItem, PrometheusSample, Sweep, SweepDetail, SweepCreatePayload } from './types'

const base = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  getConfig: () => request<ConfigPayload>('/config'),
  putConfig: (payload: ConfigPayload) =>
    request<{ status: string }>('/config', { method: 'PUT', body: JSON.stringify(payload) }),

  listRuns: () => request<RunListItem[]>('/runs'),
  getRun: (id: number) => request<Run>(`/runs/${id}`),
  createRun: (name?: string) =>
    request<Run>('/runs', { method: 'POST', body: JSON.stringify({ name }) }),
  stopRun: (id: number) =>
    request<void>(`/runs/${id}`, { method: 'DELETE' }),

  getRunPrometheus: (id: number) =>
    request<PrometheusSample[]>(`/runs/${id}/prometheus`),

  listSweeps: () => request<Sweep[]>('/sweeps'),
  getSweep: (id: number) => request<SweepDetail>(`/sweeps/${id}`),
  createSweep: (body: SweepCreatePayload) =>
    request<Sweep>('/sweeps', { method: 'POST', body: JSON.stringify(body) }),
  cancelSweep: (id: number) =>
    request<void>(`/sweeps/${id}`, { method: 'DELETE' }),
}
```

- [ ] **Step 3: Remove `disabled: true` from Sweeps in `frontend/src/components/Sidebar.tsx`**

Change the links array so Sweeps has no disabled flag:

```typescript
const links = [
  { to: '/runs/new', icon: Play, label: 'New Run' },
  { to: '/runs', icon: List, label: 'Results' },
  { to: '/sweeps', icon: RotateCcw, label: 'Sweeps' },
  { to: '/chat', icon: MessageSquare, label: 'AI Chat', disabled: true },
]
```

- [ ] **Step 4: Add sweep routes to `frontend/src/App.tsx`**

```typescript
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import NewRunPage from './pages/NewRun'
import ResultsPage from './pages/Results'
import RunDetailPage from './pages/RunDetail'
import SweepsPage from './pages/Sweeps'
import NewSweepPage from './pages/Sweeps/NewSweep'
import SweepDetailPage from './pages/Sweeps/SweepDetail'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/runs/new" replace />} />
        <Route path="/runs/new" element={<NewRunPage />} />
        <Route path="/runs" element={<ResultsPage />} />
        <Route path="/runs/:id" element={<RunDetailPage />} />
        <Route path="/sweeps" element={<SweepsPage />} />
        <Route path="/sweeps/new" element={<NewSweepPage />} />
        <Route path="/sweeps/:id" element={<SweepDetailPage />} />
      </Routes>
    </Layout>
  )
}
```

- [ ] **Step 5: Verify TypeScript compilation**

```bash
cd /Users/cnelson/sandbox/omb_ui/frontend && npx tsc --noEmit
```

Expected: no errors (there will be errors about missing page modules — that's fine until Tasks 4-6 add them). Ensure no errors on types.ts or client.ts.

- [ ] **Step 6: Commit**

```bash
cd /Users/cnelson/sandbox/omb_ui && git add frontend/src/api/types.ts frontend/src/api/client.ts frontend/src/components/Sidebar.tsx frontend/src/App.tsx && git commit -m "feat: add sweep API types, client methods, routes, and enable sidebar link"
```

---

## Task 4: Sweeps List Page + Results Badge

**Files:**
- Create: `frontend/src/pages/Sweeps/index.tsx`
- Modify: `frontend/src/pages/Results/RunTable.tsx`

### Sweeps list page

Shows all sweeps in a table. Polls every 5s while any sweep is `running`. Uses `useQuery` with TanStack Query v5. Progress bar uses `completed_count / run_count`. Est. remaining uses `est_seconds_remaining` from the API (formatted as "N hrs M min" or "—").

### Results badge

`RunListItem` now includes `sweep_id`. Each row with a `sweep_id` gets an inline `↗ Sweep #N` badge (indigo, links to `/sweeps/{sweep_id}`). Clicking the badge navigates to the sweep without triggering the row's run-detail navigation.

- [ ] **Step 1: Create `frontend/src/pages/Sweeps/index.tsx`**

```typescript
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '@/api/client'
import type { Sweep } from '@/api/types'

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: 'bg-blue-900 text-blue-300 border border-blue-600',
    completed: 'bg-emerald-900 text-emerald-300 border border-emerald-700',
    failed: 'bg-red-900 text-red-300 border border-red-700',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status] ?? colors.failed}`}>
      {status}
    </span>
  )
}

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0
  const done = completed === total && total > 0
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-1.5 rounded-full ${done ? 'bg-emerald-500' : 'bg-indigo-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-slate-500">{completed} / {total}</span>
    </div>
  )
}

function fmtRemaining(seconds: number | null): string {
  if (seconds == null) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h > 0) return `~${h}h ${m}m`
  return `~${m}m`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diffDays === 1) return 'yesterday'
  return `${diffDays} days ago`
}

export default function SweepsPage() {
  const navigate = useNavigate()
  const { data: sweeps = [] } = useQuery({
    queryKey: ['sweeps'],
    queryFn: api.listSweeps,
    refetchInterval: (query) =>
      query.state.data?.some((s: Sweep) => s.status === 'running') ? 5000 : false,
  })

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Sweeps</h1>
          <p className="text-sm text-slate-400 mt-0.5">Parameter sweep history</p>
        </div>
        <button
          onClick={() => navigate('/sweeps/new')}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-2 rounded-md transition-colors"
        >
          + New Sweep
        </button>
      </div>

      <div className="rounded-lg border border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 text-slate-400 text-xs uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Progress</th>
              <th className="px-4 py-3 text-left">Parameters swept</th>
              <th className="px-4 py-3 text-left">Started</th>
              <th className="px-4 py-3 text-left">Est. remaining</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {sweeps.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No sweeps yet — create one to compare parameter combinations
                </td>
              </tr>
            )}
            {sweeps.map((sweep) => (
              <tr
                key={sweep.id}
                className="hover:bg-slate-800 cursor-pointer transition-colors"
                onClick={() => navigate(`/sweeps/${sweep.id}`)}
              >
                <td className="px-4 py-3 text-indigo-400 font-medium hover:underline">
                  {sweep.name}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={sweep.status} />
                </td>
                <td className="px-4 py-3">
                  <ProgressBar completed={sweep.completed_count} total={sweep.run_count} />
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-400">
                  {Object.keys(sweep.parameter_axes).join(' · ')}
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs">
                  {fmtDate(sweep.started_at)}
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">
                  {sweep.status === 'running' ? fmtRemaining(sweep.est_seconds_remaining) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update `frontend/src/pages/Results/RunTable.tsx`** to add sweep badge

```typescript
import { useNavigate } from 'react-router-dom'
import type { RunListItem } from '@/api/types'

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: 'bg-emerald-900 text-emerald-300',
    running: 'bg-indigo-900 text-indigo-300 animate-pulse',
    failed: 'bg-red-900 text-red-300',
    pending: 'bg-slate-700 text-slate-300',
    cancelled: 'bg-slate-700 text-slate-400',
  }
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status] ?? colors.pending}`}>{status}</span>
}

function fmt(v: number | null | undefined, decimals = 1): string {
  return v != null ? v.toFixed(decimals) : '—'
}

interface Props { runs: RunListItem[] }

export default function RunTable({ runs }: Props) {
  const navigate = useNavigate()
  return (
    <div className="rounded-lg border border-slate-700 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-800 text-slate-400 text-xs uppercase tracking-wider">
          <tr>
            <th className="px-4 py-3 text-left">#</th>
            <th className="px-4 py-3 text-left">Label</th>
            <th className="px-4 py-3 text-left">Status</th>
            <th className="px-4 py-3 text-left">Started</th>
            <th className="px-4 py-3 text-right">Pub Rate</th>
            <th className="px-4 py-3 text-right">p99 (ms)</th>
            <th className="px-4 py-3 text-right">p99.9 (ms)</th>
            <th className="px-4 py-3 text-right">E2E p99 (ms)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {runs.length === 0 && (
            <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">No runs yet — start one from New Run</td></tr>
          )}
          {runs.map(run => (
            <tr key={run.id}
              className="hover:bg-slate-800 cursor-pointer transition-colors"
              onClick={() => navigate(`/runs/${run.id}`)}>
              <td className="px-4 py-3 text-slate-400">{run.id}</td>
              <td className="px-4 py-3 text-slate-200">
                {run.name ?? <span className="text-slate-500">—</span>}
                {run.sweep_id != null && (
                  <span
                    className="ml-2 inline-block bg-indigo-950 border border-indigo-800 text-indigo-400 text-xs px-1.5 py-0 rounded cursor-pointer hover:bg-indigo-900"
                    onClick={(e) => { e.stopPropagation(); navigate(`/sweeps/${run.sweep_id}`) }}
                  >
                    ↗ Sweep #{run.sweep_id}
                  </span>
                )}
              </td>
              <td className="px-4 py-3"><StatusBadge status={run.status} /></td>
              <td className="px-4 py-3 text-slate-400">{new Date(run.started_at).toLocaleString()}</td>
              <td className="px-4 py-3 text-right font-mono text-slate-300">
                {run.publish_rate_avg != null ? `${Math.round(run.publish_rate_avg).toLocaleString()}/s` : '—'}
              </td>
              <td className="px-4 py-3 text-right font-mono text-emerald-400">{fmt(run.publish_latency_p99)}</td>
              <td className="px-4 py-3 text-right font-mono text-amber-400">{fmt(run.publish_latency_p999)}</td>
              <td className="px-4 py-3 text-right font-mono text-slate-300">{fmt(run.end_to_end_latency_p99)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript compilation**

```bash
cd /Users/cnelson/sandbox/omb_ui/frontend && npx tsc --noEmit
```

Expected: errors about `NewSweep` and `SweepDetail` modules not found (from App.tsx) — acceptable. No other new errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/cnelson/sandbox/omb_ui && git add frontend/src/pages/Sweeps/index.tsx frontend/src/pages/Results/RunTable.tsx && git commit -m "feat: add sweeps list page and sweep badge on results table"
```

---

## Task 5: New Sweep Form

**Files:**
- Create: `frontend/src/pages/Sweeps/NewSweep.tsx`

### Overview

Four sections:
1. **Sweep** — name (text), cooldown (number input, labeled "seconds")
2. **Workload** — `testDurationMinutes`, `warmupDurationMinutes`, `producerRate`, `messageSize`, `partitionsPerTopic`
3. **Driver base settings** — pre-populated from saved config: `bootstrap.servers`, `replicationFactor`, `compression.type`, `request.timeout.ms`, and SASL fields (`sasl.mechanism`, `sasl.jaas.config`, `security.protocol`) — all string inputs
4. **Swept parameters** — dynamic rows: each row has a param name text input (monospace) + chip list (type + Enter to add, × to remove) + row delete button. "Add parameter" button appends a new empty row.

Live summary bar (sticky at bottom): combination count, estimated total time (combinations × (testDurationMinutes + warmupDurationMinutes + cooldown/60) minutes), and a warning banner if combinations > 12.

Pre-populate from `api.getConfig()`. On submit POST to `/api/sweeps` and redirect to `/sweeps/{id}`.

- [ ] **Step 1: Create `frontend/src/pages/Sweeps/NewSweep.tsx`**

```typescript
import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '@/api/client'

interface AxisRow { id: number; name: string; values: string[]; input: string }

function ChipInput({ row, onChange }: { row: AxisRow; onChange: (r: AxisRow) => void }) {
  return (
    <div className="flex items-start gap-2 flex-1">
      <input
        className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-xs font-mono text-slate-200 w-36 focus:outline-none focus:border-indigo-500"
        placeholder="param.name"
        value={row.name}
        onChange={(e) => onChange({ ...row, name: e.target.value })}
      />
      <div className="flex-1 flex flex-wrap gap-1 items-center bg-slate-800 border border-slate-600 rounded px-2 py-1 min-h-[32px]">
        {row.values.map((v, i) => (
          <span key={i} className="bg-indigo-900 text-indigo-300 text-xs font-mono px-2 py-0.5 rounded flex items-center gap-1">
            {v}
            <button
              type="button"
              className="text-indigo-400 hover:text-white ml-0.5"
              onClick={() => onChange({ ...row, values: row.values.filter((_, j) => j !== i) })}
            >×</button>
          </span>
        ))}
        <input
          className="bg-transparent text-xs font-mono text-slate-200 outline-none w-24 placeholder-slate-600"
          placeholder="value + ↵"
          value={row.input}
          onChange={(e) => onChange({ ...row, input: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && row.input.trim()) {
              e.preventDefault()
              onChange({ ...row, values: [...row.values, row.input.trim()], input: '' })
            }
          }}
        />
      </div>
    </div>
  )
}

let _id = 0
function newRow(): AxisRow { return { id: ++_id, name: '', values: [], input: '' } }

export default function NewSweepPage() {
  const navigate = useNavigate()
  const { data: savedConfig } = useQuery({ queryKey: ['config'], queryFn: api.getConfig })

  const [name, setName] = useState('')
  const [cooldown, setCooldown] = useState(60)
  const [testDuration, setTestDuration] = useState(20)
  const [warmupDuration, setWarmupDuration] = useState(5)
  const [producerRate, setProducerRate] = useState(10000)
  const [messageSize, setMessageSize] = useState(1024)
  const [partitions, setPartitions] = useState(10)

  const [bootstrapServers, setBootstrapServers] = useState('')
  const [replicationFactor, setReplicationFactor] = useState(3)
  const [compressionType, setCompressionType] = useState('none')
  const [requestTimeout, setRequestTimeout] = useState('120000')
  const [securityProtocol, setSecurityProtocol] = useState('')
  const [saslMechanism, setSaslMechanism] = useState('')
  const [saslJaasConfig, setSaslJaasConfig] = useState('')

  // Pre-populate from saved config when it loads
  const [configLoaded, setConfigLoaded] = useState(false)
  if (savedConfig && !configLoaded) {
    setConfigLoaded(true)
    const d = savedConfig.driver
    const w = savedConfig.workload
    setBootstrapServers(d.commonConfig['bootstrap.servers'] ?? '')
    setReplicationFactor(d.replicationFactor)
    setCompressionType(d.producerConfig['compression.type'] ?? 'none')
    setRequestTimeout(d.commonConfig['request.timeout.ms'] ?? '120000')
    setSecurityProtocol(d.commonConfig['security.protocol'] ?? '')
    setSaslMechanism(d.commonConfig['sasl.mechanism'] ?? '')
    setSaslJaasConfig(d.commonConfig['sasl.jaas.config'] ?? '')
    setTestDuration(w.testDurationMinutes)
    setWarmupDuration(w.warmupDurationMinutes)
    setProducerRate(w.producerRate)
    setMessageSize(w.messageSize)
    setPartitions(w.partitionsPerTopic)
  }

  const [axes, setAxes] = useState<AxisRow[]>([newRow()])

  const updateRow = (id: number, updated: AxisRow) =>
    setAxes(rows => rows.map(r => r.id === id ? updated : r))
  const removeRow = (id: number) =>
    setAxes(rows => rows.filter(r => r.id !== id))

  const validAxes = axes.filter(r => r.name.trim() && r.values.length > 0)
  const combinationCount = validAxes.reduce((acc, r) => acc * r.values.length, 1)
  const estimatedMinutes = combinationCount * (testDuration + warmupDuration + cooldown / 60)

  const mutation = useMutation({
    mutationFn: api.createSweep,
    onSuccess: (sweep) => navigate(`/sweeps/${sweep.id}`),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const parameterAxes: Record<string, string[]> = {}
    for (const row of validAxes) {
      parameterAxes[row.name.trim()] = row.values
    }
    const commonConfig: Record<string, string> = {
      'bootstrap.servers': bootstrapServers,
      'request.timeout.ms': requestTimeout,
    }
    if (securityProtocol) commonConfig['security.protocol'] = securityProtocol
    if (saslMechanism) commonConfig['sasl.mechanism'] = saslMechanism
    if (saslJaasConfig) commonConfig['sasl.jaas.config'] = saslJaasConfig

    mutation.mutate({
      name,
      parameter_axes: parameterAxes,
      cooldown_seconds: cooldown,
      workload_config: {
        testDurationMinutes: testDuration,
        warmupDurationMinutes: warmupDuration,
        producerRate,
        messageSize,
        partitionsPerTopic: partitions,
      },
      driver_base_config: {
        replicationFactor,
        commonConfig,
        producerConfig: { 'compression.type': compressionType },
        consumerConfig: {},
        topicConfig: {},
      },
    })
  }

  function fmtTime(minutes: number): string {
    const h = Math.floor(minutes / 60)
    const m = Math.round(minutes % 60)
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
  }

  function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-400 uppercase tracking-wide">{label}</label>
        {children}
      </div>
    )
  }

  const inputCls = "bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
  const sectionCls = "bg-slate-900 border border-slate-700 rounded-lg p-5 space-y-4"

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-100">New Sweep</h1>
        <p className="text-sm text-slate-400 mt-0.5">Run a Cartesian-product parameter sweep</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Section 1: Sweep */}
        <div className={sectionCls}>
          <h2 className="text-sm font-medium text-slate-300 uppercase tracking-wide">Sweep</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name">
              <input className={inputCls} value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. acks + batch.size tuning" />
            </Field>
            <Field label="Cooldown (seconds)">
              <input className={inputCls} type="number" min={0} value={cooldown} onChange={e => setCooldown(Number(e.target.value))} />
            </Field>
          </div>
        </div>

        {/* Section 2: Workload */}
        <div className={sectionCls}>
          <h2 className="text-sm font-medium text-slate-300 uppercase tracking-wide">Workload</h2>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Test Duration (min)">
              <input className={inputCls} type="number" min={1} value={testDuration} onChange={e => setTestDuration(Number(e.target.value))} />
            </Field>
            <Field label="Warmup Duration (min)">
              <input className={inputCls} type="number" min={0} value={warmupDuration} onChange={e => setWarmupDuration(Number(e.target.value))} />
            </Field>
            <Field label="Producer Rate (msg/s)">
              <input className={inputCls} type="number" min={1} value={producerRate} onChange={e => setProducerRate(Number(e.target.value))} />
            </Field>
            <Field label="Message Size (bytes)">
              <input className={inputCls} type="number" min={1} value={messageSize} onChange={e => setMessageSize(Number(e.target.value))} />
            </Field>
            <Field label="Partitions per Topic">
              <input className={inputCls} type="number" min={1} value={partitions} onChange={e => setPartitions(Number(e.target.value))} />
            </Field>
          </div>
        </div>

        {/* Section 3: Driver base settings */}
        <div className={sectionCls}>
          <h2 className="text-sm font-medium text-slate-300 uppercase tracking-wide">Driver Base Settings</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="bootstrap.servers">
              <input className={`${inputCls} font-mono text-xs`} value={bootstrapServers} onChange={e => setBootstrapServers(e.target.value)} />
            </Field>
            <Field label="replicationFactor">
              <input className={inputCls} type="number" min={1} value={replicationFactor} onChange={e => setReplicationFactor(Number(e.target.value))} />
            </Field>
            <Field label="compression.type">
              <input className={`${inputCls} font-mono text-xs`} value={compressionType} onChange={e => setCompressionType(e.target.value)} />
            </Field>
            <Field label="request.timeout.ms">
              <input className={`${inputCls} font-mono text-xs`} value={requestTimeout} onChange={e => setRequestTimeout(e.target.value)} />
            </Field>
            <Field label="security.protocol">
              <input className={`${inputCls} font-mono text-xs`} value={securityProtocol} onChange={e => setSecurityProtocol(e.target.value)} />
            </Field>
            <Field label="sasl.mechanism">
              <input className={`${inputCls} font-mono text-xs`} value={saslMechanism} onChange={e => setSaslMechanism(e.target.value)} />
            </Field>
            <div className="col-span-2">
              <Field label="sasl.jaas.config">
                <input className={`${inputCls} font-mono text-xs w-full`} value={saslJaasConfig} onChange={e => setSaslJaasConfig(e.target.value)} />
              </Field>
            </div>
          </div>
        </div>

        {/* Section 4: Swept parameters */}
        <div className={sectionCls}>
          <h2 className="text-sm font-medium text-slate-300 uppercase tracking-wide">Swept Parameters</h2>
          <div className="space-y-2">
            {axes.map(row => (
              <div key={row.id} className="flex items-start gap-2">
                <ChipInput row={row} onChange={(r) => updateRow(row.id, r)} />
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  className="text-slate-500 hover:text-red-400 text-lg leading-none mt-1.5"
                  title="Remove parameter"
                >×</button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setAxes(rows => [...rows, newRow()])}
            className="text-indigo-400 hover:text-indigo-300 text-sm mt-2"
          >
            + Add parameter
          </button>
        </div>

        {/* Live summary */}
        <div className={`${sectionCls} bg-slate-800`}>
          <div className="flex items-center justify-between">
            <div className="flex gap-6 text-sm">
              <span className="text-slate-400">
                Combinations: <span className="text-slate-100 font-medium">{combinationCount}</span>
              </span>
              <span className="text-slate-400">
                Est. total: <span className="text-slate-100 font-medium">{fmtTime(estimatedMinutes)}</span>
              </span>
            </div>
            {combinationCount > 12 && (
              <span className="text-amber-400 text-xs">⚠ Large sweep — consider fewer values</span>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={mutation.isPending || !name.trim() || validAxes.length === 0}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-6 py-2 rounded-md text-sm font-medium transition-colors"
          >
            {mutation.isPending ? 'Creating…' : 'Create Sweep'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/sweeps')}
            className="text-slate-400 hover:text-slate-200 px-4 py-2 rounded-md text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
        {mutation.isError && (
          <p className="text-red-400 text-sm">{String(mutation.error)}</p>
        )}
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd /Users/cnelson/sandbox/omb_ui/frontend && npx tsc --noEmit
```

Expected: only errors about missing `SweepDetail` module. No errors in `NewSweep.tsx`.

- [ ] **Step 3: Commit**

```bash
cd /Users/cnelson/sandbox/omb_ui && git add frontend/src/pages/Sweeps/NewSweep.tsx && git commit -m "feat: add New Sweep form with chip-style parameter axes and live summary"
```

---

## Task 6: Sweep Detail Page

**Files:**
- Create: `frontend/src/pages/Sweeps/SweepDetail.tsx`

### Overview

**Header:** sweep name + status badge, summary line ("started X · Y of Z runs complete · est. N remaining"), Cancel button (only while running).

**Progress card:** current run's sweep_params formatted as `param=value · param=value`. Progress bar fill = completed/total. Metadata row: elapsed, remaining, cooldown, failed count.

**Comparison table:** one column per swept parameter (indigo monospace), then `publish rate`, `pub p99`, `e2e p99`, `status`, link to run detail. Best value per metric column highlighted green; worst highlighted red (only among completed rows). Pending rows dimmed with `—`.

Polls every 3s while `sweep.status === 'running'`. Cancel calls `api.cancelSweep` then invalidates the query.

- [ ] **Step 1: Create `frontend/src/pages/Sweeps/SweepDetail.tsx`**

```typescript
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { Run, SweepDetail } from '@/api/types'

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: 'bg-blue-900 text-blue-300 border border-blue-600',
    completed: 'bg-emerald-900 text-emerald-300 border border-emerald-700',
    failed: 'bg-red-900 text-red-300 border border-red-700',
    pending: 'bg-slate-700 text-slate-400',
    cancelled: 'bg-slate-700 text-slate-400',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status] ?? colors.pending}`}>
      {status}
    </span>
  )
}

function fmtSeconds(seconds: number | null | undefined): string {
  if (seconds == null) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

function elapsedSeconds(startedAt: string): number {
  return Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
}

function computeBestWorst(runs: Run[], key: (r: Run) => number | null | undefined) {
  const vals = runs
    .filter(r => r.status === 'completed')
    .map(r => ({ id: r.id, val: key(r) }))
    .filter(x => x.val != null) as { id: number; val: number }[]
  if (vals.length < 2) return { best: null, worst: null }
  const sorted = [...vals].sort((a, b) => a.val - b.val)
  return { best: sorted[0].id, worst: sorted[sorted.length - 1].id }
}

export default function SweepDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: sweep } = useQuery({
    queryKey: ['sweep', id],
    queryFn: () => api.getSweep(Number(id)),
    refetchInterval: (query) =>
      query.state.data?.status === 'running' ? 3000 : false,
  })

  const cancelMutation = useMutation({
    mutationFn: () => api.cancelSweep(Number(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sweep', id] }),
  })

  if (!sweep) {
    return <div className="p-6 text-slate-400">Loading…</div>
  }

  const paramKeys = Object.keys(sweep.parameter_axes)
  const currentRun = sweep.runs.find(r => r.status === 'running')
  const completedRuns = sweep.runs.filter(r => r.status === 'completed')
  const pct = sweep.run_count > 0 ? Math.round((sweep.completed_count / sweep.run_count) * 100) : 0

  // Best/worst per metric (lower is better for latency, higher is better for rate)
  const rateBW = computeBestWorst(sweep.runs, r => r.metrics?.publish_rate_avg)
  const pubP99BW = computeBestWorst(sweep.runs, r => r.metrics?.publish_latency_p99)
  const e2eBW = computeBestWorst(sweep.runs, r => r.metrics?.end_to_end_latency_p99)
  // For latency, lower is better → best = lowest id from computeBestWorst, worst = highest
  // For rate, higher is better → swap best/worst
  const rateBest = rateBW.worst  // worst latency-sorted = best rate
  const rateWorst = rateBW.best
  const pubP99Best = pubP99BW.best
  const pubP99Worst = pubP99BW.worst
  const e2eBest = e2eBW.best
  const e2eWorst = e2eBW.worst

  function metricCls(runId: number, best: number | null, worst: number | null): string {
    if (runId === best) return 'text-emerald-400 font-semibold'
    if (runId === worst) return 'text-red-400'
    return 'text-slate-200 font-medium'
  }

  function fmt(v: number | null | undefined, decimals = 1): string {
    return v != null ? v.toFixed(decimals) : '—'
  }

  function fmtRate(v: number | null | undefined): string {
    return v != null ? `${Math.round(v).toLocaleString()}/s` : '—'
  }

  const currentParams = currentRun?.sweep_params
    ? Object.entries(currentRun.sweep_params).map(([k, v]) => `${k}=${v}`).join(' · ')
    : null

  return (
    <div className="p-6 max-w-6xl space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-semibold text-slate-100">{sweep.name}</h1>
            <StatusBadge status={sweep.status} />
          </div>
          <p className="text-sm text-slate-400">
            Started {fmtDate(sweep.started_at)} · {sweep.completed_count} of {sweep.run_count} runs complete
            {sweep.status === 'running' && sweep.est_seconds_remaining != null &&
              ` · est. ${fmtSeconds(sweep.est_seconds_remaining)} remaining`
            }
          </p>
        </div>
        <div className="flex gap-2">
          {sweep.status === 'running' && (
            <button
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              className="border border-red-700 text-red-400 hover:bg-red-950 text-sm px-4 py-1.5 rounded-md transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          <button
            onClick={() => navigate('/sweeps')}
            className="border border-slate-600 text-slate-400 hover:text-slate-200 text-sm px-4 py-1.5 rounded-md transition-colors"
          >
            ← All Sweeps
          </button>
        </div>
      </div>

      {/* Progress card */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
        <div className="flex justify-between items-center mb-2">
          <div className="text-sm text-slate-300">
            {currentRun
              ? <>Run {sweep.runs.indexOf(currentRun) + 1} of {sweep.run_count}
                  {currentParams && <> &nbsp;—&nbsp; <span className="text-indigo-300 font-mono text-xs">{currentParams}</span></>}
                </>
              : sweep.status === 'completed' ? 'All runs complete' : 'Waiting…'
            }
          </div>
          <span className="text-sm text-slate-400">{pct}%</span>
        </div>
        <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
          <div
            className={`h-2 rounded-full transition-all ${sweep.status === 'completed' ? 'bg-emerald-500' : 'bg-indigo-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex gap-5 mt-3 text-xs text-slate-500">
          <span>elapsed <span className="text-slate-400">{fmtSeconds(elapsedSeconds(sweep.started_at))}</span></span>
          <span>remaining <span className="text-slate-400">{fmtSeconds(sweep.est_seconds_remaining)}</span></span>
          <span>cooldown <span className="text-slate-400">{sweep.cooldown_seconds}s</span></span>
          <span>failed <span className="text-slate-400">{sweep.failed_count}</span></span>
        </div>
      </div>

      {/* Comparison table */}
      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 text-slate-400 text-xs uppercase tracking-wider">
            <tr>
              <th className="px-3 py-3 text-left w-8">#</th>
              {paramKeys.map(k => (
                <th key={k} className="px-3 py-3 text-left font-mono">{k}</th>
              ))}
              <th className="px-3 py-3 text-right">Publish Rate</th>
              <th className="px-3 py-3 text-right">Pub p99</th>
              <th className="px-3 py-3 text-right">E2E p99</th>
              <th className="px-3 py-3 text-left">Status</th>
              <th className="px-3 py-3 text-left"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {sweep.runs.map((run, idx) => {
              const isPending = run.status === 'pending'
              const isRunning = run.status === 'running'
              const rowCls = isRunning ? 'bg-slate-800/60' : isPending ? 'opacity-40' : ''
              return (
                <tr key={run.id} className={`${rowCls} hover:bg-slate-800 transition-colors`}>
                  <td className="px-3 py-2.5 text-slate-500">{idx + 1}</td>
                  {paramKeys.map(k => (
                    <td key={k} className="px-3 py-2.5 font-mono text-indigo-300 text-xs">
                      {run.sweep_params?.[k] ?? '—'}
                    </td>
                  ))}
                  <td className={`px-3 py-2.5 text-right font-mono text-xs ${isPending || isRunning ? 'text-slate-600' : metricCls(run.id, rateBest, rateWorst)}`}>
                    {isPending || isRunning ? '—' : fmtRate(run.metrics?.publish_rate_avg)}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono text-xs ${isPending || isRunning ? 'text-slate-600' : metricCls(run.id, pubP99Best, pubP99Worst)}`}>
                    {isPending || isRunning ? '—' : fmt(run.metrics?.publish_latency_p99)}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono text-xs ${isPending || isRunning ? 'text-slate-600' : metricCls(run.id, e2eBest, e2eWorst)}`}>
                    {isPending || isRunning ? '—' : fmt(run.metrics?.end_to_end_latency_p99)}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="px-3 py-2.5">
                    {!isPending && (
                      <button
                        onClick={() => navigate(`/runs/${run.id}`)}
                        className="text-indigo-400 hover:underline text-xs"
                      >
                        Run #{run.id}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify full TypeScript compilation**

```bash
cd /Users/cnelson/sandbox/omb_ui/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Build the frontend**

```bash
cd /Users/cnelson/sandbox/omb_ui/frontend && npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 4: Run full backend test suite**

```bash
cd /Users/cnelson/sandbox/omb_ui && python -m pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/cnelson/sandbox/omb_ui && git add frontend/src/pages/Sweeps/SweepDetail.tsx && git commit -m "feat: add Sweep Detail page with progress bar and comparison table"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| `sweeps` table + `Run.sweep_params` | Task 1 |
| `Sweep` model with computed counts | Task 1 |
| `SweepCreate`, `SweepOut`, `SweepDetail` schemas | Task 1 |
| `POST /api/sweeps` — create + generate runs | Task 2 |
| `GET /api/sweeps` — list | Task 2 |
| `GET /api/sweeps/{id}` — detail | Task 2 |
| `DELETE /api/sweeps/{id}` — cancel | Task 2 |
| `_run_sweep` coroutine — sequential execution | Task 2 |
| Run generation via Cartesian product | Task 2 |
| Driver config overlay (`_build_driver_config`) | Task 2 |
| Backend tests (product, create, detail, cancel, failure) | Task 2 |
| Frontend types (`Sweep`, `SweepDetail`, update `Run`/`RunListItem`) | Task 3 |
| API client methods | Task 3 |
| Sidebar Sweeps link enabled | Task 3 |
| App.tsx routes `/sweeps`, `/sweeps/new`, `/sweeps/:id` | Task 3 |
| Sweeps list page with polls every 5s | Task 4 |
| Results page sweep badge `↗ Sweep #N` | Task 4 |
| New Sweep form — 4 sections | Task 5 |
| Chip-style value input | Task 5 |
| Live summary bar + warning at > 12 combinations | Task 5 |
| Pre-populate from saved config | Task 5 |
| Sweep Detail — header + cancel button | Task 6 |
| Sweep Detail — progress bar with current params | Task 6 |
| Sweep Detail — comparison table | Task 6 |
| Best/worst metric highlighting | Task 6 |
| Polls every 3s while running | Task 6 |

**All requirements covered. No TBDs.**

**Type consistency check:**
- `_run_sweep(sweep_id, runner)` — consistent in sweeps_router.py and test
- `_build_driver_config(base_config, params)` — consistent in router and test assertion
- `Sweep.runs` relationship uses `foreign_keys="[Run.sweep_id]"` — consistent with Run model
- `SweepOut.est_seconds_remaining` — added to both `@property` and Pydantic schema
- `SweepDetail extends SweepOut` with `runs: list[RunOut]` — RunOut has `sweep_params` added in Task 1
- Frontend `SweepDetail.runs` is `Run[]` (Run has sweep_params) — consistent with Task 3 types
