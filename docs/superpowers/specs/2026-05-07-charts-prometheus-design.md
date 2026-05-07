# Phase 2: Charts & Prometheus Integration Design

## Goal

Add time-series charts to the run detail page and collect Redpanda metrics from Prometheus during each benchmark run.

## Architecture

Three independent pieces that compose on the run detail page:

1. **Prometheus polling service** — background task that scrapes three PromQL queries every 10 seconds during a run and stores the samples in SQLite.
2. **Prometheus API endpoint** — serves the stored samples for a given run.
3. **Frontend charts** — three Recharts line charts on the run detail page: throughput, effective batch size, and broker bytes in/out.

---

## Backend

### New DB model: `PrometheusSample`

```
Table: prometheus_samples
  id              INTEGER PK
  run_id          INTEGER FK -> runs.id (indexed)
  t               INTEGER   -- seconds since run started_at
  batch_size_bytes  FLOAT nullable
  bytes_in_per_sec  FLOAT nullable
  bytes_out_per_sec FLOAT nullable
```

`run_id` is not unique — many samples per run. Each field is nullable so a single failed query doesn't drop the whole row.

### New service: `backend/services/prometheus_client.py`

Three functions, each returning `float | None`:

- `query_batch_size(url)` — evaluates:
  `sum(irate(vectorized_storage_log_written_bytes[30s])) / sum(irate(vectorized_storage_log_batches_written[30s]))`
- `query_bytes_in(url)` — evaluates:
  `sum(irate(redpanda_rpc_received_bytes[30s]))`
- `query_bytes_out(url)` — evaluates:
  `sum(irate(redpanda_rpc_sent_bytes[30s]))`

All use `httpx.AsyncClient` with a 5-second timeout. Any exception (connection refused, non-200, empty result) returns `None` — Prometheus errors never propagate to the run lifecycle.

### New background task: `_poll_prometheus`

Added to `runs_router.py`, started alongside `_finish_run` when a run is created:

```
while not runner.is_done(run_id):
    t = seconds since run started_at
    query all three metrics concurrently (asyncio.gather)
    write PrometheusSample row to DB
    sleep 10s
```

One final poll is made after the loop exits so the last data point is captured. Uses its own `SessionLocal` context (same pattern as `_finish_run`).

### New endpoint: `GET /api/runs/{run_id}/prometheus`

Returns `list[PrometheusSampleOut]` ordered by `t` ascending. Returns `[]` if no samples exist (Prometheus was unreachable or run is still in warmup). Registered in a new `backend/routers/prometheus_router.py`.

### Schema additions (`backend/schemas.py`)

```python
class PrometheusSampleOut(BaseModel):
    t: int
    batch_size_bytes: float | None
    bytes_in_per_sec: float | None
    bytes_out_per_sec: float | None
    model_config = {"from_attributes": True}
```

---

## Frontend

### New dependency

`recharts` — added to `frontend/package.json`. Chosen because it is React-native, has strong TypeScript types, and handles responsive containers without extra wrappers.

### New components

**`frontend/src/pages/RunDetail/ThroughputChart.tsx`**

Renders a Recharts `LineChart` from `metrics.throughput_timeseries`. X axis is elapsed seconds derived from `sample_rate_ms` (e.g. `sampleRateMs / 1000 * index`). Two lines: publish rate (indigo) and consume rate (green). Y axis labeled `msg/s`. X axis labeled `elapsed (s)` with enough ticks that intervals are clear (~6 ticks across the run duration). Tooltip shows both values at cursor. Receives `throughput_timeseries` as a prop — renders nothing if null.

**`frontend/src/pages/RunDetail/PrometheusCharts.tsx`**

Fetches `GET /api/runs/{run_id}/prometheus` via TanStack Query (no refetch interval — data is complete once the run ends). Renders two side-by-side `LineChart`s:

- **Effective batch size** — single amber line, Y axis labeled `bytes`, tooltip shows human-readable KB/MB.
- **Broker bytes in / out** — two lines (purple = in, cyan = out), Y axis labeled `bytes/s`, tooltip shows both.

Both share the same X axis style as the throughput chart. If the query returns an empty array (Prometheus unavailable), a muted notice is shown: "Prometheus data unavailable for this run."

### Updated `frontend/src/pages/RunDetail/index.tsx`

New stacked layout below the existing metric tiles and latency bars:

```
MetricsTiles
ThroughputChart          ← new, full width
PrometheusCharts         ← new, full width (two half-width charts inside)
LatencyBars              ← existing, moved below charts
Config snapshot          ← existing <details> disclosure, unchanged
```

`ThroughputChart` and `PrometheusCharts` only render when `run.status === 'completed'` and the relevant data is present.

### API client additions (`frontend/src/api/client.ts`)

```typescript
getRunPrometheus: (id: number) => GET /api/runs/{id}/prometheus → PrometheusSample[]
```

---

## Error handling

- Prometheus unreachable: polling continues, affected fields stored as `null`. Frontend shows "unavailable" notice instead of charts.
- OMB run fails: polling stops, partial samples are retained and displayed.
- Prometheus returns `NaN` or division-by-zero (e.g. no batches written yet): stored as `null`.

## Testing

- `tests/test_prometheus_client.py` — mock `httpx` responses: normal result, empty result, connection error, division-by-zero denominator.
- `tests/test_runs_api.py` — extend existing test: verify `prometheus_samples` rows are written after a run completes using mock Prometheus responses.
- Frontend: no new unit tests (chart rendering is integration-tested manually).

## Files changed

| File | Change |
|------|--------|
| `backend/models.py` | Add `PrometheusSample` model |
| `backend/schemas.py` | Add `PrometheusSampleOut` |
| `backend/services/prometheus_client.py` | New — three async query functions |
| `backend/routers/prometheus_router.py` | New — GET endpoint |
| `backend/routers/runs_router.py` | Add `_poll_prometheus` background task |
| `backend/main.py` | Register `prometheus_router` |
| `frontend/package.json` | Add `recharts` |
| `frontend/src/api/types.ts` | Add `PrometheusSample` interface |
| `frontend/src/api/client.ts` | Add `getRunPrometheus` |
| `frontend/src/pages/RunDetail/ThroughputChart.tsx` | New |
| `frontend/src/pages/RunDetail/PrometheusCharts.tsx` | New |
| `frontend/src/pages/RunDetail/index.tsx` | Add charts to layout |
| `tests/test_prometheus_client.py` | New |
