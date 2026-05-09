# OMB UI — Design Spec
**Date:** 2026-05-06
**Status:** Approved

## Overview

A standalone web application that runs on an EC2 OMB worker instance. It replaces the current workflow of SSH + vim + log-grepping with a browser-based UI for configuring, running, and analyzing Open Messaging Benchmark (OMB) runs against a Redpanda cluster.

The repo is cloned directly onto one of the OMB worker EC2 instances. A single startup command launches the server; the user opens a browser to the instance's IP.

---

## Architecture

**Stack:** Python FastAPI backend + React (TypeScript) frontend.

The FastAPI process is the single entry point. It serves the pre-built React bundle as static files and exposes REST + WebSocket endpoints for all backend operations. No Node.js runtime is required on EC2 at run time — only at build time.

```
Browser (user's laptop)
    ↕ HTTP / WebSocket
FastAPI (Python, EC2 worker)
    ├── Spawns OMB as subprocess, streams stdout over WebSocket
    ├── Reads/writes driver.yaml + workload.yaml on disk
    ├── Parses OMB JSON result file → metrics
    ├── Queries Redpanda Prometheus endpoint (:9644/metrics)
    ├── Stores results in SQLite
    ├── Calls Anthropic API (Claude) for AI assistant
    └── Serves React build as static files
```

**No auth required.** Single user, no concurrent benchmark runs.

---

## Deployment

The project is a self-contained repo. Setup:

```bash
git clone <repo> ~/omb-ui
cd ~/omb-ui
./install.sh        # pip install + npm run build
./start.sh          # launches uvicorn on port 8080
```

Configuration is read from a `.env` file in the repo root (gitignored). Required variables:
```
PROMETHEUS_URL=http://<broker-ip>:9644
ANTHROPIC_API_KEY=sk-ant-...
OMB_DIR=/opt/benchmark   # directory containing bin/benchmark and YAML files
```

A `.gitignore` entry covers the SQLite database file, `.env`, and `.superpowers/` brainstorm artifacts.

---

## OMB Runtime Details

**Working directory:** `$OMB_DIR` (default `/opt/benchmark`)

**Command:**
```bash
cd $OMB_DIR && bin/benchmark --drivers driver.yaml workload.yaml
```

**Config files** read and written in place:
- `$OMB_DIR/driver.yaml`
- `$OMB_DIR/workload.yaml`

**Result file:** OMB writes a JSON file to `$OMB_DIR` named:
```
workload-{driver_name}-{YYYY-MM-DD-HH-MM-SS}.json
```
e.g. `workload-Redpanda+SASL+TLS+0xn2d-standard-8-2026-05-07-02-04-59.json`

The result file is detected after process exit by finding the newest `workload-*.json` in `$OMB_DIR` that did not exist before the run started.

**Result file format:** Single JSON object. Key fields extracted:

| Stored metric | JSON field |
|---------------|-----------|
| `publish_rate_avg` | `mean(publishRate[])` |
| `publish_latency_avg/p50/p75/p95/p99/p999/p9999/max` | `aggregatedPublishLatency*` |
| `end_to_end_latency_avg/p50/p75/p95/p99/p999/p9999/max` | `aggregatedEndToEndLatency*` |
| `consume_rate_avg` | `mean(consumeRate[])` |
| `backlog_avg` | `mean(backlog[])` |
| throughput time series | `publishRate[]` + `consumeRate[]` arrays (one entry per `sampleRateMillis`) |

**Driver YAML structure:** Top-level keys are `driverClass`, `replicationFactor`, `reset`, `topicConfig`, `commonConfig`, `producerConfig`, `consumerConfig`. The `*Config` fields are multiline `key=value` blocks (YAML block scalar `|`). The form parses these into individual fields:
- `commonConfig`: `bootstrap.servers`, `security.protocol`, `sasl.mechanism`, SASL username/password, `request.timeout.ms`
- `producerConfig`: `acks`, `linger.ms`, `batch.size`, `compression.type`
- `consumerConfig`: `group.id`, `auto.offset.reset`, `enable.auto.commit`, `fetch.max.wait.ms`, `fetch.min.bytes`, `max.partition.fetch.bytes`

**Workload YAML structure:** All top-level scalar fields — `topics`, `partitionsPerTopic`, `messageSize`, `payloadFile`, `subscriptionsPerTopic`, `consumerPerSubscription`, `producersPerTopic`, `producerRate`, `consumerBacklogSizeGB`, `testDurationMinutes`, `warmupDurationMinutes`. Optional fields (e.g. `keyDistributor`) are omitted from YAML when blank.

**Expected rate calculator** (live, shown in workload form):
```
Produce rate  = producerRate × topics          (msg/sec)
Produce MB/s  = producerRate × topics × messageSize / 1,048,576
Consume rate  = producerRate × topics × subscriptionsPerTopic  (msg/sec)
Consume MB/s  = consume rate × messageSize / 1,048,576
Est. duration = warmupDurationMinutes + testDurationMinutes
```

---

## Data Model (SQLite)

### `runs`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| name | TEXT | optional user label |
| status | TEXT | pending \| running \| completed \| failed |
| started_at | DATETIME | |
| completed_at | DATETIME | nullable |
| driver_config | JSON | full YAML snapshot at run time |
| workload_config | JSON | full YAML snapshot at run time |
| sweep_id | INTEGER | nullable FK → sweeps.id |

### `metrics`
One row per completed run. All latency values in milliseconds, rates in msg/sec.

| Column | Type |
|--------|------|
| run_id | INTEGER FK |
| publish_rate_avg | REAL |
| publish_latency_avg / p50 / p75 / p95 / p99 / p999 / p9999 / max | REAL |
| end_to_end_latency_avg / p50 / p75 / p95 / p99 / p999 / p9999 / max | REAL |
| consume_rate_avg | REAL |
| backlog_avg | REAL |
| throughput_timeseries | JSON | `publishRate[]` + `consumeRate[]` arrays from result file |

### `prometheus_snapshots`
Time-series Prometheus data captured before, during (periodic), and after each run.

| Column | Type |
|--------|------|
| run_id | INTEGER FK |
| metric_name | TEXT |
| timestamp | DATETIME |
| value | REAL |
| labels | JSON | e.g. `{"topic": "benchmark-topic", "redpanda_id": "0"}` |

Prometheus is scraped every 30 seconds during a run, plus once immediately before start and once after completion. Captured metrics include: broker CPU, memory, network throughput, disk write rate, under-replicated partitions, and **effective write batch size** computed from:
```
sum(irate(vectorized_storage_log_written_bytes{topic!~"^_.*"}[5m])) by (topic)
/
sum(irate(vectorized_storage_log_batches_written{topic!~"^_.*"}[5m])) by (topic)
```

### `sweeps`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| name | TEXT | |
| base_driver_config | JSON | fixed baseline |
| base_workload_config | JSON | fixed baseline |
| parameter_grid | JSON | e.g. `{"batch_size": [16384, 65536], "linger_ms": [0, 5, 10]}` |
| total_runs | INTEGER | |
| completed_runs | INTEGER | |
| status | TEXT | pending \| running \| completed \| cancelled |

---

## UI

### Navigation
Persistent left sidebar with:
- **New Run** (default landing page)
- **Results**
- **Sweeps**
- **AI Chat**
- Status strip at bottom: cluster connection indicator, Prometheus status

### Page: New Run
Split-view config editor with two tabs: **Driver** and **Workload**.

- Left pane: typed form fields (text inputs, number inputs, dropdowns for enum fields like compression)
- Right pane: live YAML preview, syntax highlighted, also directly editable
- Editing either side keeps the other in sync
- "Clone from run #N" button pre-fills the form from any past run's config snapshot
- Optional run name/label field
- "Run" button launches OMB; page transitions to the live run view

**Live run view** (same page, running state):
- Streaming log tail via WebSocket (last 500 lines, auto-scroll)
- Progress bar (elapsed / estimated total based on workload duration)
- "Stop" button to kill the subprocess
- On completion: parsed metrics summary appears inline, link to full run detail

### Page: Results
Sortable, filterable table of all runs. Columns: name/label, date, status, key metrics (publish rate, p99, p99.9, e2e p99), duration. Click any row to open run detail.

**Run Detail:**
- Stat tiles: publish rate, p99, p99.9, avg e2e latency
- **Latency distribution chart**: horizontal bars (p50 → p75 → p90 → p95 → p99 → p99.9 → max), each bar shows the ms value inline, color shifts indigo → amber → red into the tail
- **Throughput over time**: line chart from OMB output
- **Prometheus cluster metrics panel**:
  - Broker CPU avg, network out, disk write rate, under-replicated partitions
  - Effective write batch size (computed PromQL above) — displayed alongside the configured batch size so divergence is immediately visible
- Full config snapshot (driver + workload YAML, collapsible)
- "Ask AI about this run" button — opens chat pre-populated with this run's context

### Page: Sweeps
**Sweep Builder:**
- Name field
- Base config: starts from current YAML files on disk (or clone from a previous run)
- Parameter grid editor: pick any field from either YAML, add a list of values to try; the label shows which file the field comes from (driver / workload)
- Live expansion preview: full Cartesian product table with estimated total runtime
- "Save sweep" and "Run all N" buttons

**Sweep Progress** (running state):
- Progress bar (N of M complete)
- Results table populates as each run finishes — safe to navigate away and return
- Crash-safe: sweep state persisted in SQLite; a resume button appears if the process was interrupted

**Sweep Results:**
- Color-coded heatmap table: rows and columns are the first two swept parameters; color intensity = p99 latency (green=best, red=worst); cell value = p99 ms. When more than 2 parameters are varied, a separate heatmap table is rendered for each combination of the remaining parameter values.
- Metric selector to switch heatmap color/value between p99, p99.9, throughput
- Effective write batch size summary per unique batch_size value in the sweep
- Best/worst run quick-compare strip
- "Ask AI about these results" button — opens chat with full sweep context

### Page: AI Chat
Chat interface backed by Claude (claude-sonnet-4-6) via the Anthropic SDK, streaming responses.

**Context loaded on every turn:**
- All run records with full metrics
- Prometheus snapshots for each run
- Current driver.yaml + workload.yaml on disk
- Sweep definitions and results
- User's latency target (set in the header strip)

**Latency target** is a persistent field in the chat header (e.g. "p99 ≤ 3ms") — Claude factors it into every suggestion without the user repeating it.

**AI actions:** Claude can return a structured sweep definition alongside prose. When detected, the UI renders an "→ Open pre-filled sweep builder" button that deep-links to the Sweep page with the grid pre-populated. This closes the insight-to-action loop.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/config` | Read current driver + workload YAML from disk |
| PUT | `/api/config` | Write driver + workload YAML to disk |
| GET | `/api/runs` | List all runs |
| POST | `/api/runs` | Start a new run (writes config to disk, spawns OMB) |
| GET | `/api/runs/{id}` | Get run detail + metrics |
| DELETE | `/api/runs/{id}` | Stop a running run |
| WS | `/ws/runs/{id}` | Stream live OMB stdout |
| GET | `/api/sweeps` | List sweeps |
| POST | `/api/sweeps` | Create + optionally start a sweep |
| GET | `/api/sweeps/{id}` | Sweep detail + all child runs |
| POST | `/api/prometheus/query` | Ad-hoc PromQL query against cluster |
| POST | `/api/chat` | Streaming chat with Claude (SSE) |

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Backend language | Python 3.11+ |
| Web framework | FastAPI + uvicorn |
| ORM / DB | SQLAlchemy + aiosqlite (SQLite) |
| YAML parsing | PyYAML |
| Prometheus queries | httpx (async) |
| AI | anthropic Python SDK (streaming) |
| Frontend framework | React 18 + TypeScript |
| Build tool | Vite |
| UI components | shadcn/ui + Tailwind CSS |
| Charts | Recharts |
| Data fetching | React Query (TanStack Query) |
| WebSocket client | native browser WebSocket |

---

## Build Order (Implementation Phases)

**Phase 1 — Foundation:** Config editor + single run execution + result capture
- FastAPI skeleton, SQLite schema, YAML read/write
- Split-view config editor (React)
- OMB subprocess runner + WebSocket stdout streaming
- OMB JSON result file detection and parsing → metrics storage
- Results table + run detail page (no charts yet)

**Phase 2 — Observability:** Charts + Prometheus integration
- Latency bar chart + throughput line chart on run detail
- Prometheus scrape during runs + effective batch size metric
- Prometheus data stored and displayed on run detail

**Phase 3 — Sweep runner**
- Sweep builder UI (grid editor + expansion preview)
- Sweep execution engine (sequential queue, crash-safe resume)
- Sweep heatmap results view

**Phase 4 — AI assistant**
- Chat page with Claude integration
- Full context injection (runs, metrics, Prometheus, configs)
- Latency target header field
- Pre-filled sweep action from AI response
