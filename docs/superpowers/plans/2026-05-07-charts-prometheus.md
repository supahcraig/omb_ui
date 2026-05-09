# Phase 2: Charts & Prometheus Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add time-series charts to the run detail page and collect Redpanda Prometheus metrics (effective batch size, bytes in/out) during each benchmark run.

**Architecture:** A new `PrometheusSample` SQLite table stores one row every 10 s during a run, written by a new `_poll_prometheus` background task that fires alongside the existing `_finish_run` task. A new `GET /api/runs/{id}/prometheus` endpoint serves those samples to the frontend. Three Recharts `LineChart` components render on the run detail page: throughput (from OMB JSON already stored), effective batch size, and broker bytes in/out (both from Prometheus).

**Tech Stack:** Python `httpx` for Prometheus HTTP queries, `recharts` npm package for charts, existing FastAPI/SQLAlchemy/React patterns throughout.

---

## File Map

| File | Action |
|------|--------|
| `backend/models.py` | Add `PrometheusSample` ORM model |
| `backend/schemas.py` | Add `PrometheusSampleOut` Pydantic schema |
| `backend/services/prometheus_client.py` | **New** — three async PromQL query functions |
| `backend/routers/runs_router.py` | Add `_poll_prometheus` background task; start it in `create_run` |
| `backend/routers/prometheus_router.py` | **New** — `GET /api/runs/{id}/prometheus` endpoint |
| `backend/main.py` | Register `prometheus_router` |
| `frontend/package.json` | Add `recharts` dependency |
| `frontend/src/api/types.ts` | Add `PrometheusSample` interface |
| `frontend/src/api/client.ts` | Add `getRunPrometheus` call |
| `frontend/src/pages/RunDetail/ThroughputChart.tsx` | **New** — publish/consume rate line chart |
| `frontend/src/pages/RunDetail/PrometheusCharts.tsx` | **New** — batch size + bytes in/out charts |
| `frontend/src/pages/RunDetail/index.tsx` | Wire in all three charts |
| `tests/test_prometheus_client.py` | **New** — unit tests for query functions |
| `tests/test_prometheus.py` | **New** — model round-trip + endpoint test |

---

## Task 1: PrometheusSample DB model and Pydantic schema

**Files:**
- Modify: `backend/models.py`
- Modify: `backend/schemas.py`
- Create: `tests/test_prometheus.py`

- [ ] **Step 1: Write the failing model round-trip test**

```python
# tests/test_prometheus.py
import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from backend.database import engine, Base
from backend.models import PrometheusSample

@pytest.mark.asyncio
async def test_prometheus_sample_round_trip():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with AsyncSession(engine, expire_on_commit=False) as session:
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /path/to/omb_ui && .venv/bin/pytest tests/test_prometheus.py -v
```

Expected: `ImportError` or `cannot import name 'PrometheusSample'`

- [ ] **Step 3: Add `PrometheusSample` to `backend/models.py`**

Add after the `Metrics` class (keep all existing imports and classes unchanged):

```python
class PrometheusSample(Base):
    __tablename__ = "prometheus_samples"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(Integer, ForeignKey("runs.id"), index=True)
    t: Mapped[int] = mapped_column(Integer)  # seconds since run started_at
    batch_size_bytes: Mapped[float | None] = mapped_column(Float, nullable=True)
    bytes_in_per_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
    bytes_out_per_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
```

- [ ] **Step 4: Add `PrometheusSampleOut` to `backend/schemas.py`**

Add after the `RunListItem` class:

```python
class PrometheusSampleOut(BaseModel):
    t: int
    batch_size_bytes: float | None
    bytes_in_per_sec: float | None
    bytes_out_per_sec: float | None
    model_config = {"from_attributes": True}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
.venv/bin/pytest tests/test_prometheus.py::test_prometheus_sample_round_trip -v
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/models.py backend/schemas.py tests/test_prometheus.py
git commit -m "feat: add PrometheusSample model and schema"
```

---

## Task 2: Prometheus client service

**Files:**
- Create: `backend/services/prometheus_client.py`
- Create: `tests/test_prometheus_client.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_prometheus_client.py
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


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
        from backend.services.prometheus_client import query_batch_size
        result = await query_batch_size("http://localhost:9644")
    assert result == pytest.approx(131072.0)


@pytest.mark.asyncio
async def test_query_returns_none_on_empty_result():
    payload = {"data": {"result": []}}
    with patch("httpx.AsyncClient", return_value=_mock_httpx_client(payload)):
        from backend.services.prometheus_client import query_bytes_in
        result = await query_bytes_in("http://localhost:9644")
    assert result is None


@pytest.mark.asyncio
async def test_query_returns_none_on_connection_error():
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(side_effect=Exception("connection refused"))
    ctx.__aexit__ = AsyncMock(return_value=None)
    with patch("httpx.AsyncClient", return_value=ctx):
        from backend.services.prometheus_client import query_bytes_out
        result = await query_bytes_out("http://localhost:9644")
    assert result is None


@pytest.mark.asyncio
async def test_query_returns_none_on_nan():
    payload = {"data": {"result": [{"value": [0, "nan"]}]}}
    with patch("httpx.AsyncClient", return_value=_mock_httpx_client(payload)):
        from backend.services.prometheus_client import query_batch_size
        result = await query_batch_size("http://localhost:9644")
    assert result is None
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
.venv/bin/pytest tests/test_prometheus_client.py -v
```

Expected: `ModuleNotFoundError: No module named 'backend.services.prometheus_client'`

- [ ] **Step 3: Create `backend/services/prometheus_client.py`**

```python
import httpx
from backend.config import settings


async def _instant_query(url: str, query: str) -> float | None:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{url}/api/v1/query", params={"query": query})
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
    u = url or settings.PROMETHEUS_URL
    return await _instant_query(
        u,
        "sum(irate(vectorized_storage_log_written_bytes[30s])) / "
        "sum(irate(vectorized_storage_log_batches_written[30s]))",
    )


async def query_bytes_in(url: str | None = None) -> float | None:
    u = url or settings.PROMETHEUS_URL
    return await _instant_query(u, "sum(irate(redpanda_rpc_received_bytes[30s]))")


async def query_bytes_out(url: str | None = None) -> float | None:
    u = url or settings.PROMETHEUS_URL
    return await _instant_query(u, "sum(irate(redpanda_rpc_sent_bytes[30s]))")
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
.venv/bin/pytest tests/test_prometheus_client.py -v
```

Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/services/prometheus_client.py tests/test_prometheus_client.py
git commit -m "feat: add Prometheus client service with batch size and bytes queries"
```

---

## Task 3: Polling background task and REST endpoint

**Files:**
- Modify: `backend/routers/runs_router.py`
- Create: `backend/routers/prometheus_router.py`
- Modify: `backend/main.py`
- Modify: `tests/test_prometheus.py`

- [ ] **Step 1: Write the failing endpoint test**

Add to `tests/test_prometheus.py`:

```python
import pytest
from httpx import AsyncClient, ASGITransport
from backend.main import app
from backend.database import engine, Base, SessionLocal
from backend.models import PrometheusSample


@pytest.mark.asyncio
async def test_prometheus_endpoint_returns_samples():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with SessionLocal() as session:
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
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/runs/99999/prometheus")
    assert resp.status_code == 200
    assert resp.json() == []
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
.venv/bin/pytest tests/test_prometheus.py::test_prometheus_endpoint_returns_samples tests/test_prometheus.py::test_prometheus_endpoint_returns_empty_list_for_unknown_run -v
```

Expected: `404 Not Found` (route doesn't exist yet)

- [ ] **Step 3: Create `backend/routers/prometheus_router.py`**

```python
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
```

- [ ] **Step 4: Register the router in `backend/main.py`**

Replace the existing import line and `include_router` calls:

```python
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from backend.database import init_db
from backend.services.omb_runner import OmbRunner
from backend.routers import config_router, runs_router, ws_router, prometheus_router

STATIC_DIR = Path(__file__).parent.parent / "frontend" / "dist"

runner_instance = OmbRunner()

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    runs_router.set_runner(runner_instance)
    yield

app = FastAPI(title="OMB UI", lifespan=lifespan)

app.include_router(config_router.router)
app.include_router(runs_router.router)
app.include_router(ws_router.router)
app.include_router(prometheus_router.router)

if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        return FileResponse(str(STATIC_DIR / "index.html"))
```

- [ ] **Step 5: Run endpoint tests to verify they pass**

```bash
.venv/bin/pytest tests/test_prometheus.py -v
```

Expected: all 3 tests PASS

- [ ] **Step 6: Add `_poll_prometheus` to `backend/routers/runs_router.py`**

Add these imports at the top (after existing imports):

```python
import asyncio
from backend.database import SessionLocal
from backend.models import Run, Metrics, PrometheusSample
from backend.services.prometheus_client import query_batch_size, query_bytes_in, query_bytes_out
```

Note: `asyncio` and `SessionLocal` are currently imported inside function bodies — adding them at module level is fine and makes `_poll_prometheus` cleaner. Keep the existing functions (`_finish_run`, routes) unchanged.

Add `_poll_prometheus` after `_finish_run`:

```python
async def _poll_prometheus(run_id: int, runner: OmbRunner, started_at: datetime) -> None:
    """Background task: poll Prometheus every 10 s while the run is active."""
    while not runner.is_done(run_id):
        t = int((datetime.utcnow() - started_at).total_seconds())
        batch, b_in, b_out = await asyncio.gather(
            query_batch_size(),
            query_bytes_in(),
            query_bytes_out(),
        )
        async with SessionLocal() as db:
            db.add(PrometheusSample(
                run_id=run_id, t=t,
                batch_size_bytes=batch,
                bytes_in_per_sec=b_in,
                bytes_out_per_sec=b_out,
            ))
            await db.commit()
        await asyncio.sleep(10)

    # One final sample captured after the run ends
    t = int((datetime.utcnow() - started_at).total_seconds())
    batch, b_in, b_out = await asyncio.gather(
        query_batch_size(),
        query_bytes_in(),
        query_bytes_out(),
    )
    async with SessionLocal() as db:
        db.add(PrometheusSample(
            run_id=run_id, t=t,
            batch_size_bytes=batch,
            bytes_in_per_sec=b_in,
            bytes_out_per_sec=b_out,
        ))
        await db.commit()
```

- [ ] **Step 7: Start `_poll_prometheus` in `create_run`**

In the `create_run` endpoint, add one line after the existing `background_tasks.add_task(_finish_run, ...)`:

```python
    await runner.start(run.id)
    background_tasks.add_task(_finish_run, run.id, runner)
    background_tasks.add_task(_poll_prometheus, run.id, runner, run.started_at)
```

- [ ] **Step 8: Write a test for `_poll_prometheus`**

Add to `tests/test_prometheus.py`:

```python
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_poll_prometheus_writes_final_sample():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

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
```

- [ ] **Step 9: Run all prometheus tests**

```bash
.venv/bin/pytest tests/test_prometheus.py tests/test_prometheus_client.py -v
```

Expected: all 7 tests PASS

- [ ] **Step 10: Run the full test suite to check for regressions**

```bash
.venv/bin/pytest -v
```

Expected: all tests PASS

- [ ] **Step 11: Commit**

```bash
git add backend/routers/runs_router.py backend/routers/prometheus_router.py backend/main.py tests/test_prometheus.py
git commit -m "feat: add Prometheus polling task and /api/runs/{id}/prometheus endpoint"
```

---

## Task 4: Frontend — install Recharts and add API types

**Files:**
- Modify: `frontend/package.json` (via npm install)
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: Install recharts**

```bash
npm --prefix frontend install recharts
```

Expected: `recharts` appears in `frontend/package.json` dependencies.

- [ ] **Step 2: Add `PrometheusSample` to `frontend/src/api/types.ts`**

Add at the end of the file:

```typescript
export interface PrometheusSample {
  t: number
  batch_size_bytes: number | null
  bytes_in_per_sec: number | null
  bytes_out_per_sec: number | null
}
```

- [ ] **Step 3: Add `getRunPrometheus` to `frontend/src/api/client.ts`**

Update the import line and add the new method:

```typescript
import type { ConfigPayload, Run, RunListItem, PrometheusSample } from './types'

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
}
```

- [ ] **Step 4: Verify build passes**

```bash
npm --prefix frontend run build 2>&1 | tail -5
```

Expected: `✓ built in ...`

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/api/types.ts frontend/src/api/client.ts
git commit -m "feat: add recharts, PrometheusSample type, and getRunPrometheus API call"
```

---

## Task 5: ThroughputChart component

**Files:**
- Create: `frontend/src/pages/RunDetail/ThroughputChart.tsx`

The chart reads from `metrics.throughput_timeseries` which is already stored in every completed run. The `sample_rate_ms` field tells us the interval between samples (e.g. `10000` = one sample every 10 s), so `index * sample_rate_ms / 1000` gives elapsed seconds.

- [ ] **Step 1: Create `frontend/src/pages/RunDetail/ThroughputChart.tsx`**

```typescript
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

interface Timeseries {
  publish_rate: number[]
  consume_rate: number[]
  sample_rate_ms: number
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

const TICK  = { fill: '#64748b', fontSize: 11 }
const GRID  = '#1e293b'
const TT_STYLE = { background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', fontSize: '12px' }

export default function ThroughputChart({ timeseries }: { timeseries: Timeseries }) {
  const data = timeseries.publish_rate.map((rate, i) => ({
    t: Math.round((i * timeseries.sample_rate_ms) / 1000),
    publish: Math.round(rate),
    consume: Math.round(timeseries.consume_rate[i] ?? 0),
  }))

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-5">
      <div className="text-sm font-medium text-slate-300 mb-4">Throughput over time</div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis
            dataKey="t"
            tickFormatter={fmtTime}
            tickCount={9}
            tick={TICK}
            label={{ value: 'elapsed (mm:ss)', position: 'insideBottom', offset: -12, fill: '#475569', fontSize: 11 }}
          />
          <YAxis
            tick={TICK}
            width={65}
            tickFormatter={v => v.toLocaleString()}
            label={{ value: 'msg/s', angle: -90, position: 'insideLeft', offset: 10, fill: '#475569', fontSize: 11 }}
          />
          <Tooltip
            contentStyle={TT_STYLE}
            labelFormatter={s => `t = ${fmtTime(s as number)}`}
            formatter={(v: number, name: string) => [v.toLocaleString(), name]}
          />
          <Legend wrapperStyle={{ fontSize: '11px', color: '#94a3b8', paddingTop: '8px' }} />
          <Line type="monotone" dataKey="publish" name="publish rate" stroke="#6366f1" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="consume" name="consume rate" stroke="#10b981" dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
```

- [ ] **Step 2: Verify build passes**

```bash
npm --prefix frontend run build 2>&1 | tail -5
```

Expected: `✓ built in ...`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/RunDetail/ThroughputChart.tsx
git commit -m "feat: add ThroughputChart component using Recharts"
```

---

## Task 6: PrometheusCharts component

**Files:**
- Create: `frontend/src/pages/RunDetail/PrometheusCharts.tsx`

Two side-by-side charts: batch size in KB (amber) and broker bytes in/out in MB/s (purple/cyan). If the Prometheus endpoint returns an empty array (Prometheus was unreachable), show a muted notice instead.

- [ ] **Step 1: Create `frontend/src/pages/RunDetail/PrometheusCharts.tsx`**

```typescript
import { useQuery } from '@tanstack/react-query'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { api } from '@/api/client'
import type { PrometheusSample } from '@/api/types'

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const TICK     = { fill: '#64748b', fontSize: 11 }
const GRID     = '#1e293b'
const TT_STYLE = { background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', fontSize: '12px' }
const MARGIN   = { top: 5, right: 20, left: 10, bottom: 24 }
const XLABEL   = { value: 'elapsed (mm:ss)', position: 'insideBottom' as const, offset: -12, fill: '#475569', fontSize: 11 }

function batchPoints(samples: PrometheusSample[]) {
  return samples.map(s => ({
    t: s.t,
    batch_kb: s.batch_size_bytes != null ? Math.round(s.batch_size_bytes / 1024) : null,
  }))
}

function bytesPoints(samples: PrometheusSample[]) {
  return samples.map(s => ({
    t: s.t,
    bytes_in:  s.bytes_in_per_sec  != null ? parseFloat((s.bytes_in_per_sec  / (1024 * 1024)).toFixed(2)) : null,
    bytes_out: s.bytes_out_per_sec != null ? parseFloat((s.bytes_out_per_sec / (1024 * 1024)).toFixed(2)) : null,
  }))
}

export default function PrometheusCharts({ runId }: { runId: number }) {
  const { data: samples = [] } = useQuery({
    queryKey: ['prometheus', runId],
    queryFn: () => api.getRunPrometheus(runId),
  })

  if (samples.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-5">
        <div className="text-sm text-slate-500">Prometheus data unavailable for this run.</div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-5">
        <div className="text-sm font-medium text-slate-300 mb-4">Effective batch size</div>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={batchPoints(samples)} margin={MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis dataKey="t" tickFormatter={fmtTime} tickCount={9} tick={TICK} label={XLABEL} />
            <YAxis tick={TICK} width={48}
              label={{ value: 'KB', angle: -90, position: 'insideLeft', offset: 10, fill: '#475569', fontSize: 11 }} />
            <Tooltip contentStyle={TT_STYLE} labelFormatter={s => `t = ${fmtTime(s as number)}`} />
            <Line type="monotone" dataKey="batch_kb" name="batch size (KB)"
              stroke="#f59e0b" dot={false} strokeWidth={2} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-slate-900 border border-slate-700 rounded-lg p-5">
        <div className="text-sm font-medium text-slate-300 mb-4">Broker bytes in / out</div>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={bytesPoints(samples)} margin={MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis dataKey="t" tickFormatter={fmtTime} tickCount={9} tick={TICK} label={XLABEL} />
            <YAxis tick={TICK} width={55}
              label={{ value: 'MB/s', angle: -90, position: 'insideLeft', offset: 10, fill: '#475569', fontSize: 11 }} />
            <Tooltip contentStyle={TT_STYLE} labelFormatter={s => `t = ${fmtTime(s as number)}`} />
            <Legend wrapperStyle={{ fontSize: '11px', color: '#94a3b8', paddingTop: '8px' }} />
            <Line type="monotone" dataKey="bytes_in"  name="bytes in"  stroke="#8b5cf6" dot={false} strokeWidth={2} connectNulls />
            <Line type="monotone" dataKey="bytes_out" name="bytes out" stroke="#06b6d4" dot={false} strokeWidth={2} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify build passes**

```bash
npm --prefix frontend run build 2>&1 | tail -5
```

Expected: `✓ built in ...`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/RunDetail/PrometheusCharts.tsx
git commit -m "feat: add PrometheusCharts component (batch size + bytes in/out)"
```

---

## Task 7: Wire charts into the RunDetail page

**Files:**
- Modify: `frontend/src/pages/RunDetail/index.tsx`

New stacked layout: tiles → throughput chart → Prometheus charts (side-by-side) → latency bars → config disclosure. `ThroughputChart` only renders when `throughput_timeseries` is present. `PrometheusCharts` renders for completed runs (shows "unavailable" gracefully if no data).

- [ ] **Step 1: Replace `frontend/src/pages/RunDetail/index.tsx`**

```typescript
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { api } from '@/api/client'
import MetricsTiles from './MetricsTiles'
import LatencyBars from './LatencyBars'
import ThroughputChart from './ThroughputChart'
import PrometheusCharts from './PrometheusCharts'

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>()
  const runId = Number(id)

  const { data: run, isLoading } = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.getRun(runId),
    refetchInterval: (query) => query.state.data?.status === 'running' ? 3000 : false,
  })

  if (isLoading) return <div className="text-slate-400">Loading…</div>
  if (!run) return <div className="text-red-400">Run not found</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Run #{run.id}{run.name ? ` — ${run.name}` : ''}</h1>
          <p className="text-slate-400 text-sm mt-1">
            {new Date(run.started_at).toLocaleString()}
            {run.completed_at && ` → ${new Date(run.completed_at).toLocaleString()}`}
            {' · '}<span className="capitalize">{run.status}</span>
          </p>
        </div>
        <Link to="/runs">
          <Button variant="outline" size="sm">← All Results</Button>
        </Link>
      </div>

      {run.metrics && <MetricsTiles metrics={run.metrics} />}

      {run.metrics?.throughput_timeseries && (
        <ThroughputChart timeseries={run.metrics.throughput_timeseries} />
      )}

      {run.status === 'completed' && <PrometheusCharts runId={run.id} />}

      {run.metrics && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-5">
          <LatencyBars metrics={run.metrics} />
        </div>
      )}

      {run.status === 'running' && (
        <div className="bg-indigo-900/30 border border-indigo-700 rounded-lg p-4 text-indigo-300 text-sm">
          Run in progress — metrics will appear when complete.
        </div>
      )}

      <details className="bg-slate-900 border border-slate-700 rounded-lg">
        <summary className="px-5 py-3 cursor-pointer text-sm text-slate-400 hover:text-white">
          Config used for this run ▸
        </summary>
        <div className="px-5 pb-4 grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-indigo-400 uppercase tracking-wider mb-2">Driver</div>
            <pre className="text-xs text-slate-300 overflow-auto max-h-64 bg-slate-950 p-3 rounded">
              {JSON.stringify(run.driver_config, null, 2)}
            </pre>
          </div>
          <div>
            <div className="text-xs text-indigo-400 uppercase tracking-wider mb-2">Workload</div>
            <pre className="text-xs text-slate-300 overflow-auto max-h-64 bg-slate-950 p-3 rounded">
              {JSON.stringify(run.workload_config, null, 2)}
            </pre>
          </div>
        </div>
      </details>
    </div>
  )
}
```

- [ ] **Step 2: Verify build passes**

```bash
npm --prefix frontend run build 2>&1 | tail -5
```

Expected: `✓ built in ...`

- [ ] **Step 3: Run the full backend test suite**

```bash
.venv/bin/pytest -v
```

Expected: all tests PASS

- [ ] **Step 4: Smoke-test manually**

Start the server:
```bash
.venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8080
```

Open `http://localhost:8080`. Start a run. When it completes, open the run detail page and verify:
- Three charts appear (throughput, batch size, bytes in/out)
- X axes show mm:ss labels with ~9 ticks
- Latency bars still appear below the charts
- "Prometheus data unavailable" shows if `PROMETHEUS_URL` is unreachable (expected in local dev)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/RunDetail/index.tsx
git commit -m "feat: Phase 2 complete — throughput and Prometheus charts on run detail"
```
