# Phase 3: Sweep Runner Design

## Goal

Run a Cartesian-product sweep over driver configuration parameters, with a configurable cooldown between runs, and display results in a comparison table.

## Architecture

A new `Sweep` DB model holds the parameter axes and execution state. When a sweep is created, all `Run` rows are generated upfront (status=`pending`) and a single `_run_sweep` background coroutine executes them sequentially — same pattern as the existing `_finish_run` task. The frontend adds three new pages (New Sweep, Sweeps list, Sweep Detail) and a badge on the existing Results page.

---

## Data Model

### `sweeps` table

```
id                INTEGER PK
name              TEXT
status            TEXT     -- running | completed | failed
parameter_axes    JSON     -- {"acks":["0","1","all"],"batch.size":["16384","131072"]}
cooldown_seconds  INTEGER  -- default 60
started_at        DATETIME
completed_at      DATETIME nullable
```

### `runs` table additions

`sweep_params` — new nullable JSON column storing the specific combination for this run, e.g. `{"acks":"1","batch.size":"131072"}`. `sweep_id` already exists.

`Run.status` gains a new value: `cancelled` (used when a sweep is cancelled mid-run for pending runs that were never started).

---

## Backend

### New model: `Sweep` (`backend/models.py`)

```python
class Sweep(Base):
    __tablename__ = "sweeps"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="running")
    parameter_axes: Mapped[dict] = mapped_column(JSON)
    cooldown_seconds: Mapped[int] = mapped_column(Integer, default=60)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    runs: Mapped[list["Run"]] = relationship("Run", foreign_keys="Run.sweep_id", primaryjoin="Run.sweep_id == Sweep.id")
```

Add to `Run`:
```python
sweep_params: Mapped[dict | None] = mapped_column(JSON, nullable=True)
```

### New schemas (`backend/schemas.py`)

```python
class SweepCreate(BaseModel):
    name: str
    parameter_axes: dict[str, list[str]]   # param name -> list of string values
    cooldown_seconds: int = 60
    workload_config: dict = {}             # full workload config for all runs
    driver_base_config: dict = {}          # base driver config; swept params overlay this

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
    model_config = {"from_attributes": True}

class SweepDetail(SweepOut):
    runs: list[RunOut]
```

### New router: `backend/routers/sweeps_router.py`

```
POST   /api/sweeps          create sweep, generate runs, launch _run_sweep
GET    /api/sweeps          list all sweeps (SweepOut[])
GET    /api/sweeps/{id}     sweep detail with runs (SweepDetail)
DELETE /api/sweeps/{id}     cancel: stop current run, mark remaining pending as cancelled
```

### `_run_sweep` background coroutine

Added to `sweeps_router.py`:

```
for each pending run in sweep (ordered by id):
    set run.status = "running"
    await runner.start(run.id)
    launch _finish_run(run.id, runner) and _poll_prometheus(run.id, runner, run.started_at)
    while not runner.is_done(run.id):
        await asyncio.sleep(2)
    poll DB until run.status != "running" (max 30s timeout; on timeout log and continue)
    if run.status in ("failed", "cancelled"): continue   # skip, don't abort sweep
    await asyncio.sleep(sweep.cooldown_seconds)

set sweep.status = "completed", sweep.completed_at = now
```

Exceptions in the coroutine are caught per-run; the sweep never dies from a single failed run.

### Run generation (in `POST /api/sweeps`)

Compute `itertools.product(*parameter_axes.values())` to get all combinations. For each combination:
- Apply the combination's parameter values on top of `driver_base_config`
- Use `workload_config` as-is for all runs
- Create `Run(status="pending", sweep_id=sweep.id, sweep_params={param: value, ...}, driver_config=..., workload_config=...)`

Show the estimated run count in the `SweepOut` response so the UI can warn immediately.

---

## Frontend

### New pages

| Route | Page |
|-------|------|
| `/sweeps` | Sweeps list |
| `/sweeps/new` | New Sweep form |
| `/sweeps/:id` | Sweep Detail |

### New Sweep (`/sweeps/new`)

Four sections:

1. **Sweep** — name (text), cooldown (number, default 60, labeled "seconds")
2. **Workload** — fixed fields: `testDurationMinutes`, `warmupDurationMinutes`, `producerRate`, `messageSize`, `partitionsPerTopic` — pre-populated from current saved config, editable
3. **Driver base settings** — fixed fields: `bootstrap.servers`, `replicationFactor`, `compression.type`, `request.timeout.ms`, `sasl.*` — pre-populated from saved config, editable
4. **Driver swept parameters** — dynamic rows: parameter name (text input, monospace) + chip-style value list (type value + Enter to add, × to remove) + row remove button. "Add parameter" button appends a new empty row.

Live summary bar (updates as axes change):
- Combination count = product of all axis lengths
- Estimated total time = combinations × (testDurationMinutes + warmupDurationMinutes + cooldown_seconds/60) minutes
- Warning banner when combinations > 12: "Large sweep — consider fewer values"

On submit: `POST /api/sweeps`, redirect to `/sweeps/{id}`.

### Sweeps list (`/sweeps`)

Table columns: Name (link to detail), Status badge, Progress bar (X / Y runs), Parameters swept (comma-separated param names, monospace), Started, Est. remaining.

"+ New Sweep" button top-right. Polls every 5s while any sweep has status=`running`.

### Sweep Detail (`/sweeps/:id`)

**Header:** sweep name, status badge, "started X · Y of Z runs complete · est. N hrs remaining". Cancel button (only while running).

**Progress bar:** label shows current run's `sweep_params` formatted as `param=value · param=value`. Fill = completed/total. Metadata row: elapsed, remaining, cooldown, failed count.

**Comparison table:** one row per run, columns:
- One column per swept parameter (values in indigo monospace)
- `publish rate` (avg msg/s)
- `pub p99` latency
- `e2e p99` latency
- `status` badge
- Link to individual Run Detail page

Best value per metric column highlighted green; worst highlighted red. Pending rows shown dimmed with `—` for metric values. Polls every 3s while sweep is running.

### Results page update (`frontend/src/pages/Results/RunTable.tsx`)

Each run row that has a `sweep_id` gets a small inline badge: `↗ Sweep #N` (indigo, links to `/sweeps/{sweep_id}`). No other changes to the existing table.

### Sidebar

Add "Sweeps" link between "New Run" and "Results" in `frontend/src/components/Sidebar.tsx`.

### API additions (`frontend/src/api/`)

```typescript
// types.ts
interface Sweep { id, name, status, parameter_axes, cooldown_seconds, started_at, completed_at, run_count, completed_count, failed_count }
interface SweepDetail extends Sweep { runs: Run[] }

// client.ts
listSweeps: () => GET /api/sweeps → Sweep[]
getSweep: (id) => GET /api/sweeps/{id} → SweepDetail
createSweep: (body) => POST /api/sweeps → Sweep
cancelSweep: (id) => DELETE /api/sweeps/{id}
```

---

## Error Handling

- **Run fails mid-sweep:** logged, `run.status = "failed"`, sweep continues with next combination. Final `sweep.status` is `completed` regardless of individual failures (failed count shown in header).
- **Sweep cancelled:** current run is stopped via `runner.stop()`, remaining pending runs are marked `cancelled`, sweep status set to `failed`.
- **Server restart mid-sweep:** the in-progress coroutine is lost. Sweep remains in `running` status permanently. A future restart-recovery mechanism is out of scope — the user can cancel and re-run.

## Testing

- `tests/test_sweeps.py`:
  - Cartesian product generation produces correct run count and param combinations
  - `POST /api/sweeps` creates sweep + N runs with correct `sweep_params`
  - `GET /api/sweeps/{id}` returns runs with metrics after completion
  - `DELETE /api/sweeps/{id}` marks remaining runs cancelled
  - `_run_sweep` continues past a failed run (mock runner returning non-zero exit)

## Files Changed

| File | Change |
|------|--------|
| `backend/models.py` | Add `Sweep` model; add `sweep_params` to `Run` |
| `backend/schemas.py` | Add `SweepCreate`, `SweepOut`, `SweepDetail` |
| `backend/routers/sweeps_router.py` | **New** — CRUD endpoints + `_run_sweep`; imports `_finish_run` and `_poll_prometheus` from `runs_router` |
| `backend/main.py` | Register `sweeps_router` |
| `frontend/src/api/types.ts` | Add `Sweep`, `SweepDetail` |
| `frontend/src/api/client.ts` | Add sweep API calls |
| `frontend/src/components/Sidebar.tsx` | Add Sweeps link |
| `frontend/src/App.tsx` | Add sweep routes |
| `frontend/src/pages/Sweeps/index.tsx` | **New** — Sweeps list page |
| `frontend/src/pages/Sweeps/NewSweep.tsx` | **New** — New Sweep form |
| `frontend/src/pages/Sweeps/SweepDetail.tsx` | **New** — Sweep detail + comparison table |
| `frontend/src/pages/Results/RunTable.tsx` | Add sweep badge to run rows |
| `tests/test_sweeps.py` | **New** |
