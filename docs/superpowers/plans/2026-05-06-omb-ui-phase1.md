# OMB UI — Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working web app that runs OMB benchmarks from a browser, streams live output, parses results, and displays them in a results table and run detail view.

**Architecture:** Python FastAPI backend serves a pre-built React SPA. The backend reads/writes OMB YAML configs in place, spawns OMB as a subprocess, streams stdout over WebSocket, detects and parses the JSON result file, and stores metrics in SQLite. The React frontend provides a split-view config editor (form + live YAML), live run view, and results browser.

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy (async) + aiosqlite, PyYAML, React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, React Router v6, React Query, js-yaml, @uiw/react-codemirror

**Spec:** `docs/superpowers/specs/2026-05-06-omb-ui-design.md`
**Phases 2–4** (charts+Prometheus, sweeps, AI chat) will be separate plans built on top of this one.

---

## File Map

```
omb-ui/
├── backend/
│   ├── __init__.py
│   ├── main.py              # FastAPI app, lifespan, static file serving
│   ├── config.py            # Pydantic Settings from .env
│   ├── database.py          # Async SQLAlchemy engine + session
│   ├── models.py            # ORM: Run, Metrics
│   ├── schemas.py           # Pydantic request/response models
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── config_router.py # GET/PUT /api/config
│   │   ├── runs_router.py   # CRUD + start/stop runs
│   │   └── ws_router.py     # WS /ws/runs/{id}
│   └── services/
│       ├── __init__.py
│       ├── yaml_io.py       # Parse/write driver + workload YAML
│       ├── omb_runner.py    # Async subprocess + stdout collection
│       └── result_parser.py # Parse OMB JSON result → metrics dict
├── frontend/
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   └── src/
│       ├── main.tsx
│       ├── App.tsx          # Router + layout wrapper
│       ├── api/
│       │   ├── types.ts     # TypeScript interfaces
│       │   └── client.ts    # fetch wrappers for all endpoints
│       ├── components/
│       │   ├── Layout.tsx   # Sidebar + main content shell
│       │   └── Sidebar.tsx  # Nav links + cluster status indicator
│       └── pages/
│           ├── NewRun/
│           │   ├── index.tsx        # Page: compose editor + launcher
│           │   ├── ConfigEditor.tsx # Split-view: tabs + form + yaml
│           │   ├── DriverForm.tsx   # Driver YAML form fields
│           │   ├── WorkloadForm.tsx # Workload form + rate calculator
│           │   ├── YamlEditor.tsx   # CodeMirror YAML pane
│           │   └── LiveRun.tsx      # WS log tail + progress bar
│           ├── Results/
│           │   ├── index.tsx        # Page: run list
│           │   └── RunTable.tsx     # Sortable runs table
│           └── RunDetail/
│               ├── index.tsx        # Page: single run detail
│               └── MetricsTiles.tsx # Stat tiles (rate, p99, etc.)
├── tests/
│   ├── conftest.py
│   ├── test_yaml_io.py
│   ├── test_result_parser.py
│   └── test_runs_api.py
├── .env.example
├── .gitignore
├── install.sh
├── start.sh
└── requirements.txt
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `requirements.txt`
- Create: `frontend/package.json` (bootstrapped via Vite)
- Create: `.env.example`
- Create: `.gitignore`
- Create: `install.sh`
- Create: `start.sh`

- [ ] **Step 1: Create requirements.txt**

```
fastapi==0.115.0
uvicorn[standard]==0.30.6
sqlalchemy[asyncio]==2.0.36
aiosqlite==0.20.0
pyyaml==6.0.2
python-dotenv==1.0.1
httpx==0.27.2
anthropic==0.40.0
pytest==8.3.3
pytest-asyncio==0.24.0
httpx==0.27.2
```

- [ ] **Step 2: Create .env.example**

```
OMB_DIR=/opt/benchmark
PROMETHEUS_URL=http://localhost:9644
ANTHROPIC_API_KEY=sk-ant-...
```

- [ ] **Step 3: Create .gitignore**

```
.env
*.db
*.db-shm
*.db-wal
__pycache__/
*.pyc
.pytest_cache/
node_modules/
frontend/dist/
.superpowers/
```

- [ ] **Step 4: Create install.sh**

```bash
#!/usr/bin/env bash
set -e

echo "Installing Python dependencies..."
pip install -r requirements.txt

echo "Installing frontend dependencies and building..."
cd frontend
npm install
npm run build
cd ..

echo "Done. Copy .env.example to .env and fill in values, then run ./start.sh"
```

Run: `chmod +x install.sh`

- [ ] **Step 5: Create start.sh**

```bash
#!/usr/bin/env bash
set -e
uvicorn backend.main:app --host 0.0.0.0 --port 8080 --reload
```

Run: `chmod +x start.sh`

- [ ] **Step 6: Scaffold the frontend with Vite**

```bash
cd /path/to/omb-ui
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm install -D tailwindcss@3 postcss autoprefixer @types/node
npm install react-router-dom @tanstack/react-query js-yaml @types/js-yaml
npm install @uiw/react-codemirror @codemirror/lang-yaml
npm install lucide-react class-variance-authority clsx tailwind-merge
npx tailwindcss init -p
```

- [ ] **Step 7: Install shadcn/ui**

```bash
cd frontend
npx shadcn-ui@latest init
# Choose: TypeScript, Default style, CSS variables, src/components/ui
npx shadcn-ui@latest add button input label tabs card badge table
```

- [ ] **Step 8: Create backend package skeleton**

```bash
mkdir -p backend/routers backend/services tests
touch backend/__init__.py backend/routers/__init__.py backend/services/__init__.py
touch tests/__init__.py tests/conftest.py
```

- [ ] **Step 9: Configure Vite to proxy API calls in dev**

Edit `frontend/vite.config.ts`:
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
})
```

- [ ] **Step 10: Commit**

```bash
git init
git add .
git commit -m "feat: project scaffold — FastAPI + React + Vite"
```

---

## Task 2: Backend Config and Database

**Files:**
- Create: `backend/config.py`
- Create: `backend/database.py`
- Create: `backend/models.py`

- [ ] **Step 1: Write failing test for settings loading**

Create `tests/test_config.py`:
```python
import os
import pytest
from backend.config import Settings

def test_settings_defaults():
    s = Settings(OMB_DIR="/opt/benchmark", PROMETHEUS_URL="http://localhost:9644", ANTHROPIC_API_KEY="test")
    assert s.OMB_DIR == "/opt/benchmark"
    assert s.db_url == "sqlite+aiosqlite:///./omb_ui.db"
```

Run: `pytest tests/test_config.py -v`
Expected: ImportError (module doesn't exist yet)

- [ ] **Step 2: Create backend/config.py**

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    OMB_DIR: str = "/opt/benchmark"
    PROMETHEUS_URL: str = "http://localhost:9644"
    ANTHROPIC_API_KEY: str = ""
    db_url: str = "sqlite+aiosqlite:///./omb_ui.db"

    class Config:
        env_file = ".env"

settings = Settings()
```

Note: add `pydantic-settings==2.6.1` to requirements.txt.

- [ ] **Step 3: Run test to verify it passes**

```bash
pytest tests/test_config.py -v
```
Expected: PASS

- [ ] **Step 4: Create backend/database.py**

```python
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from backend.config import settings

engine = create_async_engine(settings.db_url, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

async def get_db() -> AsyncSession:
    async with SessionLocal() as session:
        yield session

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
```

- [ ] **Step 5: Create backend/models.py**

```python
from datetime import datetime
from sqlalchemy import Integer, String, Float, DateTime, ForeignKey, JSON, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.database import Base

class Run(Base):
    __tablename__ = "runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="pending")  # pending|running|completed|failed
    started_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    driver_config: Mapped[dict] = mapped_column(JSON)
    workload_config: Mapped[dict] = mapped_column(JSON)
    sweep_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    metrics: Mapped["Metrics | None"] = relationship("Metrics", back_populates="run", uselist=False)

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
```

- [ ] **Step 6: Commit**

```bash
git add backend/ tests/
git commit -m "feat: backend config, database models"
```

---

## Task 3: YAML I/O Service

**Files:**
- Create: `backend/services/yaml_io.py`
- Create: `tests/test_yaml_io.py`
- Create: `tests/fixtures/driver.yaml`
- Create: `tests/fixtures/workload.yaml`

- [ ] **Step 1: Create test fixtures**

Create `tests/fixtures/driver.yaml`:
```yaml
driverClass: io.openmessaging.benchmark.driver.redpanda.RedpandaBenchmarkDriver
replicationFactor: 3
reset: true
topicConfig: |
commonConfig: |
  bootstrap.servers=broker:9092
  sasl.jaas.config=org.apache.kafka.common.security.scram.ScramLoginModule required username='user' password='pass';
  security.protocol=SASL_SSL
  sasl.mechanism=SCRAM-SHA-256
  request.timeout.ms=120000
producerConfig: |
  acks=all
  linger.ms=1
consumerConfig: |
  group.id=benchGroup
  auto.offset.reset=earliest
  enable.auto.commit=false
  fetch.max.wait.ms=50
  fetch.min.bytes=1
  max.partition.fetch.bytes=10485760
```

Create `tests/fixtures/workload.yaml`:
```yaml
topics: 1
partitionsPerTopic: 10
messageSize: 1024
payloadFile: "payload/payload-1Kb.data"
subscriptionsPerTopic: 1
consumerPerSubscription: 1
producersPerTopic: 10
producerRate: 10000
consumerBacklogSizeGB: 0
testDurationMinutes: 20
warmupDurationMinutes: 5
```

- [ ] **Step 2: Write failing tests**

Create `tests/test_yaml_io.py`:
```python
import pytest
from pathlib import Path
from backend.services.yaml_io import parse_driver_yaml, parse_workload_yaml, build_driver_yaml, build_workload_yaml

FIXTURES = Path(__file__).parent / "fixtures"

def test_parse_driver_extracts_top_level():
    content = (FIXTURES / "driver.yaml").read_text()
    parsed = parse_driver_yaml(content)
    assert parsed["driverClass"] == "io.openmessaging.benchmark.driver.redpanda.RedpandaBenchmarkDriver"
    assert parsed["replicationFactor"] == 3
    assert parsed["reset"] is True

def test_parse_driver_extracts_common_config():
    content = (FIXTURES / "driver.yaml").read_text()
    parsed = parse_driver_yaml(content)
    assert parsed["commonConfig"]["bootstrap.servers"] == "broker:9092"
    assert parsed["commonConfig"]["security.protocol"] == "SASL_SSL"
    # Value with = in it must not be split
    assert "ScramLoginModule" in parsed["commonConfig"]["sasl.jaas.config"]

def test_parse_driver_extracts_producer_config():
    content = (FIXTURES / "driver.yaml").read_text()
    parsed = parse_driver_yaml(content)
    assert parsed["producerConfig"]["acks"] == "all"
    assert parsed["producerConfig"]["linger.ms"] == "1"

def test_roundtrip_driver():
    content = (FIXTURES / "driver.yaml").read_text()
    parsed = parse_driver_yaml(content)
    rebuilt = build_driver_yaml(parsed)
    re_parsed = parse_driver_yaml(rebuilt)
    assert re_parsed["commonConfig"]["bootstrap.servers"] == parsed["commonConfig"]["bootstrap.servers"]
    assert re_parsed["producerConfig"]["linger.ms"] == parsed["producerConfig"]["linger.ms"]

def test_parse_workload():
    content = (FIXTURES / "workload.yaml").read_text()
    parsed = parse_workload_yaml(content)
    assert parsed["topics"] == 1
    assert parsed["producerRate"] == 10000
    assert parsed["messageSize"] == 1024
    assert parsed["testDurationMinutes"] == 20

def test_roundtrip_workload():
    content = (FIXTURES / "workload.yaml").read_text()
    parsed = parse_workload_yaml(content)
    rebuilt = build_workload_yaml(parsed)
    re_parsed = parse_workload_yaml(rebuilt)
    assert re_parsed["producerRate"] == parsed["producerRate"]
    assert re_parsed.get("keyDistributor") == parsed.get("keyDistributor")
```

Run: `pytest tests/test_yaml_io.py -v`
Expected: ImportError

- [ ] **Step 3: Create backend/services/yaml_io.py**

```python
import yaml
from pathlib import Path
from backend.config import settings


def _parse_kv_block(block: str) -> dict:
    """Parse a multiline key=value block (e.g. Kafka client config)."""
    result = {}
    for line in (block or "").strip().splitlines():
        line = line.strip()
        if "=" in line:
            key, _, value = line.partition("=")
            result[key.strip()] = value.strip()
    return result


def _build_kv_block(kv: dict) -> str:
    if not kv:
        return ""
    return "\n".join(f"{k}={v}" for k, v in kv.items()) + "\n"


def parse_driver_yaml(content: str) -> dict:
    data = yaml.safe_load(content) or {}
    return {
        "driverClass": data.get("driverClass", ""),
        "replicationFactor": data.get("replicationFactor", 3),
        "reset": data.get("reset", True),
        "topicConfig": _parse_kv_block(data.get("topicConfig") or ""),
        "commonConfig": _parse_kv_block(data.get("commonConfig") or ""),
        "producerConfig": _parse_kv_block(data.get("producerConfig") or ""),
        "consumerConfig": _parse_kv_block(data.get("consumerConfig") or ""),
    }


def build_driver_yaml(parsed: dict) -> str:
    data = {
        "driverClass": parsed.get("driverClass", ""),
        "replicationFactor": parsed.get("replicationFactor", 3),
        "reset": parsed.get("reset", True),
        "topicConfig": _build_kv_block(parsed.get("topicConfig", {})) or None,
        "commonConfig": _build_kv_block(parsed.get("commonConfig", {})) or None,
        "producerConfig": _build_kv_block(parsed.get("producerConfig", {})) or None,
        "consumerConfig": _build_kv_block(parsed.get("consumerConfig", {})) or None,
    }
    return yaml.dump(data, default_flow_style=False, allow_unicode=True, sort_keys=False)


def parse_workload_yaml(content: str) -> dict:
    data = yaml.safe_load(content) or {}
    # Return all present fields; omit keys with None values
    return {k: v for k, v in data.items() if v is not None}


def build_workload_yaml(parsed: dict) -> str:
    return yaml.dump(parsed, default_flow_style=False, allow_unicode=True, sort_keys=False)


def read_driver() -> dict:
    path = Path(settings.OMB_DIR) / "driver.yaml"
    return parse_driver_yaml(path.read_text())


def write_driver(parsed: dict) -> None:
    path = Path(settings.OMB_DIR) / "driver.yaml"
    path.write_text(build_driver_yaml(parsed))


def read_workload() -> dict:
    path = Path(settings.OMB_DIR) / "workload.yaml"
    return parse_workload_yaml(path.read_text())


def write_workload(parsed: dict) -> None:
    path = Path(settings.OMB_DIR) / "workload.yaml"
    path.write_text(build_workload_yaml(parsed))
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_yaml_io.py -v
```
Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/services/yaml_io.py tests/
git commit -m "feat: YAML I/O service with driver/workload parsing"
```

---

## Task 4: OMB Result Parser

**Files:**
- Create: `backend/services/result_parser.py`
- Create: `tests/fixtures/sample_result.json`
- Create (modify): `tests/test_result_parser.py`

- [ ] **Step 1: Create sample result fixture**

Create `tests/fixtures/sample_result.json` with this minimal but realistic structure:
```json
{
  "driver": "Redpanda+SASL+TLS+test",
  "messageSize": 1024,
  "topics": 1,
  "partitions": 10,
  "sampleRateMillis": 10000,
  "publishRate": [10337.6, 10004.5, 10001.7, 9997.3, 10003.7, 9997.1],
  "consumeRate": [10336.5, 10004.5, 9999.6, 9998.3, 10001.6, 9998.2],
  "backlog": [0, 0, 21, 11, 32, 21],
  "aggregatedPublishLatencyAvg": 8.163,
  "aggregatedPublishLatency50pct": 8.154,
  "aggregatedPublishLatency75pct": 10.806,
  "aggregatedPublishLatency95pct": 13.002,
  "aggregatedPublishLatency99pct": 14.33,
  "aggregatedPublishLatency999pct": 16.179,
  "aggregatedPublishLatency9999pct": 21.701,
  "aggregatedPublishLatencyMax": 36.669,
  "aggregatedEndToEndLatencyAvg": 8.966,
  "aggregatedEndToEndLatency50pct": 8.886,
  "aggregatedEndToEndLatency75pct": 11.507,
  "aggregatedEndToEndLatency95pct": 13.732,
  "aggregatedEndToEndLatency99pct": 15.268,
  "aggregatedEndToEndLatency999pct": 22.033,
  "aggregatedEndToEndLatency9999pct": 221.005,
  "aggregatedEndToEndLatencyMax": 250.385
}
```

- [ ] **Step 2: Write failing tests**

Create `tests/test_result_parser.py`:
```python
import pytest
from pathlib import Path
from backend.services.result_parser import parse_result_file

FIXTURE = Path(__file__).parent / "fixtures" / "sample_result.json"

def test_parse_publish_rate_avg():
    m = parse_result_file(str(FIXTURE))
    # mean of [10337.6, 10004.5, 10001.7, 9997.3, 10003.7, 9997.1] ≈ 10057.0
    assert 10000 < m["publish_rate_avg"] < 10400

def test_parse_publish_latency_percentiles():
    m = parse_result_file(str(FIXTURE))
    assert m["publish_latency_p50"] == 8.154
    assert m["publish_latency_p99"] == 14.33
    assert m["publish_latency_p9999"] == 21.701
    assert m["publish_latency_max"] == 36.669

def test_parse_end_to_end_latency():
    m = parse_result_file(str(FIXTURE))
    assert m["end_to_end_latency_p99"] == 15.268
    assert m["end_to_end_latency_p9999"] == 221.005

def test_throughput_timeseries_included():
    m = parse_result_file(str(FIXTURE))
    assert m["throughput_timeseries"]["publish_rate"] == pytest.approx(
        [10337.6, 10004.5, 10001.7, 9997.3, 10003.7, 9997.1], rel=1e-3
    )
    assert m["throughput_timeseries"]["sample_rate_ms"] == 10000

def test_backlog_avg():
    m = parse_result_file(str(FIXTURE))
    # mean of [0, 0, 21, 11, 32, 21] ≈ 14.17
    assert abs(m["backlog_avg"] - 14.17) < 0.1
```

Run: `pytest tests/test_result_parser.py -v`
Expected: ImportError

- [ ] **Step 3: Create backend/services/result_parser.py**

```python
import json
import statistics


def parse_result_file(path: str) -> dict:
    with open(path) as f:
        data = json.load(f)

    return {
        "publish_rate_avg": statistics.mean(data["publishRate"]),
        "consume_rate_avg": statistics.mean(data["consumeRate"]),
        "backlog_avg": statistics.mean(data["backlog"]),
        "publish_latency_avg": data["aggregatedPublishLatencyAvg"],
        "publish_latency_p50": data["aggregatedPublishLatency50pct"],
        "publish_latency_p75": data["aggregatedPublishLatency75pct"],
        "publish_latency_p95": data["aggregatedPublishLatency95pct"],
        "publish_latency_p99": data["aggregatedPublishLatency99pct"],
        "publish_latency_p999": data["aggregatedPublishLatency999pct"],
        "publish_latency_p9999": data["aggregatedPublishLatency9999pct"],
        "publish_latency_max": data["aggregatedPublishLatencyMax"],
        "end_to_end_latency_avg": data["aggregatedEndToEndLatencyAvg"],
        "end_to_end_latency_p50": data["aggregatedEndToEndLatency50pct"],
        "end_to_end_latency_p75": data["aggregatedEndToEndLatency75pct"],
        "end_to_end_latency_p95": data["aggregatedEndToEndLatency95pct"],
        "end_to_end_latency_p99": data["aggregatedEndToEndLatency99pct"],
        "end_to_end_latency_p999": data["aggregatedEndToEndLatency999pct"],
        "end_to_end_latency_p9999": data["aggregatedEndToEndLatency9999pct"],
        "end_to_end_latency_max": data["aggregatedEndToEndLatencyMax"],
        "throughput_timeseries": {
            "publish_rate": data["publishRate"],
            "consume_rate": data["consumeRate"],
            "sample_rate_ms": data["sampleRateMillis"],
        },
    }
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_result_parser.py -v
```
Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/services/result_parser.py tests/
git commit -m "feat: OMB JSON result file parser"
```

---

## Task 5: OMB Runner Service

**Files:**
- Create: `backend/services/omb_runner.py`

- [ ] **Step 1: Create backend/services/omb_runner.py**

```python
import asyncio
import glob
import os
from pathlib import Path
from backend.config import settings


class OmbRunner:
    """Manages a single OMB subprocess. Collects stdout in memory."""

    def __init__(self):
        # run_id -> {"process", "lines", "done", "returncode", "result_file"}
        self._active: dict[int, dict] = {}

    async def start(self, run_id: int) -> None:
        omb_dir = Path(settings.OMB_DIR)
        existing_jsons = set(glob.glob(str(omb_dir / "workload-*.json")))

        proc = await asyncio.create_subprocess_exec(
            str(omb_dir / "bin" / "benchmark"),
            "--drivers", "driver.yaml",
            "workload.yaml",
            cwd=str(omb_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        state: dict = {
            "process": proc,
            "lines": [],
            "done": False,
            "returncode": None,
            "result_file": None,
        }
        self._active[run_id] = state
        asyncio.create_task(self._collect(run_id, proc, existing_jsons, state))

    async def _collect(
        self,
        run_id: int,
        proc: asyncio.subprocess.Process,
        existing_jsons: set,
        state: dict,
    ) -> None:
        assert proc.stdout is not None
        async for raw in proc.stdout:
            state["lines"].append(raw.decode().rstrip())

        await proc.wait()
        state["returncode"] = proc.returncode

        omb_dir = Path(settings.OMB_DIR)
        new_jsons = set(glob.glob(str(omb_dir / "workload-*.json"))) - existing_jsons
        if new_jsons:
            state["result_file"] = max(new_jsons, key=os.path.getmtime)

        state["done"] = True

    def get_lines(self, run_id: int) -> list[str]:
        state = self._active.get(run_id)
        return state["lines"] if state else []

    def is_done(self, run_id: int) -> bool:
        state = self._active.get(run_id)
        return state["done"] if state else True

    def get_result_file(self, run_id: int) -> str | None:
        state = self._active.get(run_id)
        return state.get("result_file") if state else None

    def get_returncode(self, run_id: int) -> int | None:
        state = self._active.get(run_id)
        return state.get("returncode") if state else None

    async def stop(self, run_id: int) -> None:
        state = self._active.get(run_id)
        if state and not state["done"]:
            state["process"].terminate()
            await asyncio.sleep(0.5)
            if not state["done"]:
                state["process"].kill()
```

- [ ] **Step 2: Commit**

```bash
git add backend/services/omb_runner.py
git commit -m "feat: async OMB subprocess runner"
```

---

## Task 6: Pydantic Schemas

**Files:**
- Create: `backend/schemas.py`

- [ ] **Step 1: Create backend/schemas.py**

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

    class Config:
        from_attributes = True


class RunOut(BaseModel):
    id: int
    name: str | None
    status: str
    started_at: datetime
    completed_at: datetime | None
    driver_config: dict
    workload_config: dict
    sweep_id: int | None
    metrics: MetricsOut | None

    class Config:
        from_attributes = True


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

    class Config:
        from_attributes = True
```

- [ ] **Step 2: Commit**

```bash
git add backend/schemas.py
git commit -m "feat: Pydantic API schemas"
```

---

## Task 7: Config API Router

**Files:**
- Create: `backend/routers/config_router.py`

- [ ] **Step 1: Write failing test**

Add to `tests/test_runs_api.py` (create file):
```python
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch, MagicMock
from backend.main import app

@pytest.mark.asyncio
async def test_get_config_returns_driver_and_workload():
    mock_driver = {
        "driverClass": "io.openmessaging.benchmark.driver.redpanda.RedpandaBenchmarkDriver",
        "replicationFactor": 3, "reset": True,
        "topicConfig": {}, "commonConfig": {"bootstrap.servers": "localhost:9092"},
        "producerConfig": {"acks": "all", "linger.ms": "1"},
        "consumerConfig": {"group.id": "bench"},
    }
    mock_workload = {"topics": 1, "partitionsPerTopic": 10, "messageSize": 1024,
                     "payloadFile": "payload/p.data", "subscriptionsPerTopic": 1,
                     "consumerPerSubscription": 1, "producersPerTopic": 10,
                     "producerRate": 10000, "consumerBacklogSizeGB": 0,
                     "testDurationMinutes": 20, "warmupDurationMinutes": 5}
    with patch("backend.routers.config_router.read_driver", return_value=mock_driver), \
         patch("backend.routers.config_router.read_workload", return_value=mock_workload):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/api/config")
    assert resp.status_code == 200
    body = resp.json()
    assert body["driver"]["commonConfig"]["bootstrap.servers"] == "localhost:9092"
    assert body["workload"]["producerRate"] == 10000
```

Add to `tests/conftest.py`:
```python
import pytest
import asyncio

@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()
```

Run: `pytest tests/test_runs_api.py::test_get_config_returns_driver_and_workload -v`
Expected: ImportError (main.py doesn't exist yet — that's OK, we'll fix in Task 10)

- [ ] **Step 2: Create backend/routers/config_router.py**

```python
from fastapi import APIRouter
from backend.schemas import ConfigPayload
from backend.services.yaml_io import read_driver, read_workload, write_driver, write_workload

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get("")
async def get_config() -> dict:
    return {"driver": read_driver(), "workload": read_workload()}


@router.put("")
async def put_config(payload: ConfigPayload) -> dict:
    write_driver(payload.driver.model_dump())
    write_workload(payload.workload.model_dump(exclude_none=True))
    return {"status": "ok"}
```

- [ ] **Step 3: Commit**

```bash
git add backend/routers/config_router.py tests/
git commit -m "feat: config API router GET/PUT"
```

---

## Task 8: Runs API Router

**Files:**
- Create: `backend/routers/runs_router.py`

- [ ] **Step 1: Create backend/routers/runs_router.py**

```python
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from backend.database import get_db
from backend.models import Run, Metrics
from backend.schemas import RunCreate, RunOut, RunListItem
from backend.services.yaml_io import read_driver, read_workload
from backend.services.result_parser import parse_result_file
from backend.services.omb_runner import OmbRunner

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
    import asyncio
    while not runner.is_done(run_id):
        await asyncio.sleep(2)

    from backend.database import SessionLocal
    async with SessionLocal() as db:
        run = await db.get(Run, run_id)
        if run is None:
            return

        result_file = runner.get_result_file(run_id)
        returncode = runner.get_returncode(run_id)

        if result_file and returncode == 0:
            try:
                metrics_data = parse_result_file(result_file)
                db.add(Metrics(run_id=run_id, **metrics_data))
                run.status = "completed"
            except Exception:
                run.status = "failed"
        else:
            run.status = "failed"

        run.completed_at = datetime.utcnow()
        await db.commit()


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
            publish_rate_avg=r.metrics.publish_rate_avg if r.metrics else None,
            publish_latency_p99=r.metrics.publish_latency_p99 if r.metrics else None,
            publish_latency_p999=r.metrics.publish_latency_p999 if r.metrics else None,
            end_to_end_latency_p99=r.metrics.end_to_end_latency_p99 if r.metrics else None,
        ))
    return items


@router.post("", response_model=RunOut, status_code=201)
async def create_run(
    body: RunCreate,
    background_tasks: BackgroundTasks,
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
    background_tasks.add_task(_finish_run, run.id, runner)

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
```

- [ ] **Step 2: Commit**

```bash
git add backend/routers/runs_router.py
git commit -m "feat: runs API router CRUD + lifecycle"
```

---

## Task 9: WebSocket Router

**Files:**
- Create: `backend/routers/ws_router.py`

- [ ] **Step 1: Create backend/routers/ws_router.py**

```python
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from backend.services.omb_runner import OmbRunner
from backend.routers.runs_router import get_runner

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/runs/{run_id}")
async def ws_run_output(websocket: WebSocket, run_id: int):
    runner: OmbRunner = get_runner()
    await websocket.accept()
    sent = 0
    try:
        while True:
            lines = runner.get_lines(run_id)
            for line in lines[sent:]:
                await websocket.send_text(line)
            sent = len(lines)

            if runner.is_done(run_id):
                await websocket.send_json({"type": "done"})
                break

            await asyncio.sleep(0.1)
    except WebSocketDisconnect:
        pass
    finally:
        await websocket.close()
```

- [ ] **Step 2: Commit**

```bash
git add backend/routers/ws_router.py
git commit -m "feat: WebSocket endpoint for live run output"
```

---

## Task 10: FastAPI Main App

**Files:**
- Create: `backend/main.py`

- [ ] **Step 1: Create backend/main.py**

```python
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from backend.database import init_db
from backend.services.omb_runner import OmbRunner
from backend.routers import config_router, runs_router, ws_router

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

# Serve React SPA — must come after API routes
if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        return FileResponse(str(STATIC_DIR / "index.html"))
```

- [ ] **Step 2: Run the config API test (now that main.py exists)**

```bash
pytest tests/test_runs_api.py -v
```
Expected: PASS (with mocks in place)

- [ ] **Step 3: Smoke test the server starts**

```bash
# Create a throwaway .env for testing
echo "OMB_DIR=/tmp\nANTHROPIC_API_KEY=test\nPROMETHEUS_URL=http://localhost:9644" > .env
uvicorn backend.main:app --port 8080 &
sleep 2
curl -s http://localhost:8080/api/runs | python3 -m json.tool
# Expected: [] (empty list)
kill %1
```

- [ ] **Step 4: Commit**

```bash
git add backend/main.py
git commit -m "feat: FastAPI app with lifespan, routers, SPA fallback"
```

---

## Task 11: React App Shell

**Files:**
- Modify: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/components/Layout.tsx`
- Create: `frontend/src/components/Sidebar.tsx`

- [ ] **Step 1: Update frontend/src/main.tsx**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
)
```

- [ ] **Step 2: Create frontend/src/App.tsx**

```tsx
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import NewRunPage from './pages/NewRun'
import ResultsPage from './pages/Results'
import RunDetailPage from './pages/RunDetail'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/runs/new" replace />} />
        <Route path="/runs/new" element={<NewRunPage />} />
        <Route path="/runs" element={<ResultsPage />} />
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </Layout>
  )
}
```

- [ ] **Step 3: Create frontend/src/components/Sidebar.tsx**

```tsx
import { NavLink } from 'react-router-dom'
import { Play, List, RotateCcw, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'

const links = [
  { to: '/runs/new', icon: Play, label: 'New Run' },
  { to: '/runs', icon: List, label: 'Results' },
  { to: '/sweeps', icon: RotateCcw, label: 'Sweeps', disabled: true },
  { to: '/chat', icon: MessageSquare, label: 'AI Chat', disabled: true },
]

export default function Sidebar() {
  return (
    <aside className="w-52 bg-slate-900 border-r border-slate-700 flex flex-col h-screen">
      <div className="px-4 py-5 border-b border-slate-700">
        <span className="text-indigo-400 font-bold text-lg">⚡ OMB UI</span>
      </div>
      <nav className="flex-1 px-2 py-4 space-y-1">
        {links.map(({ to, icon: Icon, label, disabled }) =>
          disabled ? (
            <div key={to} className="flex items-center gap-3 px-3 py-2 rounded text-slate-500 cursor-not-allowed text-sm">
              <Icon size={16} />{label}
            </div>
          ) : (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn('flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors',
                  isActive ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800')
              }
            >
              <Icon size={16} />{label}
            </NavLink>
          )
        )}
      </nav>
      <div className="px-4 py-3 border-t border-slate-700 text-xs text-slate-500 space-y-1">
        <div>🟢 Cluster: —</div>
        <div>📡 Prometheus: —</div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 4: Create frontend/src/components/Layout.tsx**

```tsx
import Sidebar from './Sidebar'

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-slate-950 text-slate-100">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  )
}
```

- [ ] **Step 5: Update Tailwind config to scan all source files**

Edit `frontend/tailwind.config.ts`:
```typescript
import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
} satisfies Config
```

- [ ] **Step 6: Commit**

```bash
cd frontend && npm run build && cd ..
git add frontend/
git commit -m "feat: React app shell — layout, sidebar, routing"
```

---

## Task 12: API Types and Client

**Files:**
- Create: `frontend/src/api/types.ts`
- Create: `frontend/src/api/client.ts`

- [ ] **Step 1: Create frontend/src/api/types.ts**

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
  status: 'pending' | 'running' | 'completed' | 'failed'
  started_at: string
  completed_at: string | null
  driver_config: DriverConfig
  workload_config: WorkloadConfig
  sweep_id: number | null
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
}
```

- [ ] **Step 2: Create frontend/src/api/client.ts**

```typescript
import type { ConfigPayload, Run, RunListItem } from './types'

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
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/
git commit -m "feat: TypeScript API types and client"
```

---

## Task 13: Rate Calculator + WorkloadForm

**Files:**
- Create: `frontend/src/pages/NewRun/rateCalculator.ts`
- Create: `frontend/src/pages/NewRun/WorkloadForm.tsx`
- Create: `frontend/src/__tests__/rateCalculator.test.ts`

- [ ] **Step 1: Write failing test**

Create `frontend/src/__tests__/rateCalculator.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { calculateRates } from '../pages/NewRun/rateCalculator'

describe('calculateRates', () => {
  it('calculates produce rate and MB/s', () => {
    const r = calculateRates({ producerRate: 10000, topics: 1, messageSize: 1024, subscriptionsPerTopic: 1 })
    expect(r.produceMsgPerSec).toBe(10000)
    expect(r.produceMBPerSec).toBeCloseTo(9.77, 1)
  })

  it('calculates consume rate with multiple subscriptions', () => {
    const r = calculateRates({ producerRate: 10000, topics: 1, messageSize: 1024, subscriptionsPerTopic: 2 })
    expect(r.consumeMsgPerSec).toBe(20000)
    expect(r.consumeMBPerSec).toBeCloseTo(19.53, 1)
  })

  it('scales with topic count', () => {
    const r = calculateRates({ producerRate: 1000, topics: 3, messageSize: 512, subscriptionsPerTopic: 1 })
    expect(r.produceMsgPerSec).toBe(3000)
  })

  it('calculates total duration in minutes', () => {
    const r = calculateRates({ producerRate: 1000, topics: 1, messageSize: 1024, subscriptionsPerTopic: 1,
      warmupDurationMinutes: 5, testDurationMinutes: 20 })
    expect(r.totalDurationMinutes).toBe(25)
  })
})
```

Update `frontend/vite.config.ts` to add test config:
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: { environment: 'jsdom' },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
})
```

Install vitest: `npm install -D vitest @vitest/ui jsdom`

Run: `cd frontend && npx vitest run src/__tests__/rateCalculator.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 2: Create frontend/src/pages/NewRun/rateCalculator.ts**

```typescript
interface RateInput {
  producerRate: number
  topics: number
  messageSize: number
  subscriptionsPerTopic: number
  warmupDurationMinutes?: number
  testDurationMinutes?: number
}

export interface RateResult {
  produceMsgPerSec: number
  produceMBPerSec: number
  consumeMsgPerSec: number
  consumeMBPerSec: number
  totalDurationMinutes: number
}

export function calculateRates(input: RateInput): RateResult {
  const { producerRate, topics, messageSize, subscriptionsPerTopic,
    warmupDurationMinutes = 0, testDurationMinutes = 0 } = input
  const produceMsgPerSec = producerRate * topics
  const consumeMsgPerSec = produceMsgPerSec * subscriptionsPerTopic
  return {
    produceMsgPerSec,
    produceMBPerSec: (produceMsgPerSec * messageSize) / 1_048_576,
    consumeMsgPerSec,
    consumeMBPerSec: (consumeMsgPerSec * messageSize) / 1_048_576,
    totalDurationMinutes: warmupDurationMinutes + testDurationMinutes,
  }
}
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
cd frontend && npx vitest run src/__tests__/rateCalculator.test.ts
```
Expected: all 4 PASS

- [ ] **Step 4: Create frontend/src/pages/NewRun/WorkloadForm.tsx**

```tsx
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { WorkloadConfig } from '@/api/types'
import { calculateRates } from './rateCalculator'

interface Props {
  value: WorkloadConfig
  onChange: (updated: WorkloadConfig) => void
}

function Field({ label, name, value, onChange, type = 'text' }: {
  label: string; name: string; value: string | number
  onChange: (val: string) => void; type?: string
}) {
  return (
    <div>
      <Label className="text-xs text-slate-400 uppercase tracking-wide">{label}</Label>
      <Input className="mt-1 bg-slate-900 border-slate-700 text-slate-100"
        type={type} value={value}
        onChange={e => onChange(e.target.value)} />
    </div>
  )
}

export default function WorkloadForm({ value, onChange }: Props) {
  const set = (key: keyof WorkloadConfig) => (val: string) => {
    const numeric = ['topics','partitionsPerTopic','messageSize','subscriptionsPerTopic',
      'consumerPerSubscription','producersPerTopic','producerRate','consumerBacklogSizeGB',
      'testDurationMinutes','warmupDurationMinutes']
    onChange({ ...value, [key]: numeric.includes(key) ? Number(val) : val })
  }

  const rates = calculateRates({
    producerRate: value.producerRate,
    topics: value.topics,
    messageSize: value.messageSize,
    subscriptionsPerTopic: value.subscriptionsPerTopic,
    warmupDurationMinutes: value.warmupDurationMinutes,
    testDurationMinutes: value.testDurationMinutes,
  })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Topics" name="topics" value={value.topics} onChange={set('topics')} type="number" />
        <Field label="Partitions/Topic" name="partitionsPerTopic" value={value.partitionsPerTopic} onChange={set('partitionsPerTopic')} type="number" />
        <Field label="Message Size (bytes)" name="messageSize" value={value.messageSize} onChange={set('messageSize')} type="number" />
        <Field label="Producer Rate (msg/s)" name="producerRate" value={value.producerRate} onChange={set('producerRate')} type="number" />
        <Field label="Producers/Topic" name="producersPerTopic" value={value.producersPerTopic} onChange={set('producersPerTopic')} type="number" />
        <Field label="Subscriptions/Topic" name="subscriptionsPerTopic" value={value.subscriptionsPerTopic} onChange={set('subscriptionsPerTopic')} type="number" />
        <Field label="Consumers/Subscription" name="consumerPerSubscription" value={value.consumerPerSubscription} onChange={set('consumerPerSubscription')} type="number" />
        <Field label="Consumer Backlog (GB)" name="consumerBacklogSizeGB" value={value.consumerBacklogSizeGB} onChange={set('consumerBacklogSizeGB')} type="number" />
        <Field label="Warmup (min)" name="warmupDurationMinutes" value={value.warmupDurationMinutes} onChange={set('warmupDurationMinutes')} type="number" />
        <Field label="Test Duration (min)" name="testDurationMinutes" value={value.testDurationMinutes} onChange={set('testDurationMinutes')} type="number" />
        <Field label="Payload File" name="payloadFile" value={value.payloadFile} onChange={set('payloadFile')} />
        <Field label="Key Distributor (optional)" name="keyDistributor" value={value.keyDistributor ?? ''} onChange={set('keyDistributor')} />
      </div>

      {/* Rate calculator summary */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 text-sm space-y-1">
        <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">Expected Rates</div>
        <div className="grid grid-cols-2 gap-2 text-slate-300">
          <span>Produce:</span>
          <span className="text-emerald-400 font-mono">
            {rates.produceMsgPerSec.toLocaleString()} msg/s · {rates.produceMBPerSec.toFixed(1)} MB/s
          </span>
          <span>Consume:</span>
          <span className="text-emerald-400 font-mono">
            {rates.consumeMsgPerSec.toLocaleString()} msg/s · {rates.consumeMBPerSec.toFixed(1)} MB/s
          </span>
          <span>Duration:</span>
          <span className="text-slate-400 font-mono">{rates.totalDurationMinutes} min total</span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
cd frontend && npm run build && cd ..
git add frontend/src/
git commit -m "feat: WorkloadForm with live rate calculator"
```

---

## Task 14: DriverForm

**Files:**
- Create: `frontend/src/pages/NewRun/DriverForm.tsx`

- [ ] **Step 1: Create frontend/src/pages/NewRun/DriverForm.tsx**

```tsx
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { DriverConfig } from '@/api/types'

interface Props {
  value: DriverConfig
  onChange: (updated: DriverConfig) => void
}

function KvField({ label, name, value, onChange }: {
  label: string; name: string; value: string; onChange: (v: string) => void
}) {
  return (
    <div>
      <Label className="text-xs text-slate-400 uppercase tracking-wide">{label}</Label>
      <Input className="mt-1 bg-slate-900 border-slate-700 text-slate-100 font-mono text-xs"
        value={value} onChange={e => onChange(e.target.value)} />
    </div>
  )
}

function setCommon(value: DriverConfig, key: string, val: string): DriverConfig {
  return { ...value, commonConfig: { ...value.commonConfig, [key]: val } }
}
function setProducer(value: DriverConfig, key: string, val: string): DriverConfig {
  return { ...value, producerConfig: { ...value.producerConfig, [key]: val } }
}
function setConsumer(value: DriverConfig, key: string, val: string): DriverConfig {
  return { ...value, consumerConfig: { ...value.consumerConfig, [key]: val } }
}

export default function DriverForm({ value, onChange }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-3">Connection</div>
        <div className="grid grid-cols-1 gap-3">
          <KvField label="Bootstrap Servers" name="bootstrap.servers"
            value={value.commonConfig['bootstrap.servers'] ?? ''}
            onChange={v => onChange(setCommon(value, 'bootstrap.servers', v))} />
          <KvField label="Security Protocol" name="security.protocol"
            value={value.commonConfig['security.protocol'] ?? ''}
            onChange={v => onChange(setCommon(value, 'security.protocol', v))} />
          <KvField label="SASL Mechanism" name="sasl.mechanism"
            value={value.commonConfig['sasl.mechanism'] ?? ''}
            onChange={v => onChange(setCommon(value, 'sasl.mechanism', v))} />
          <KvField label="SASL JAAS Config" name="sasl.jaas.config"
            value={value.commonConfig['sasl.jaas.config'] ?? ''}
            onChange={v => onChange(setCommon(value, 'sasl.jaas.config', v))} />
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-3">Producer</div>
        <div className="grid grid-cols-2 gap-3">
          <KvField label="acks" name="acks"
            value={value.producerConfig['acks'] ?? ''}
            onChange={v => onChange(setProducer(value, 'acks', v))} />
          <KvField label="linger.ms" name="linger.ms"
            value={value.producerConfig['linger.ms'] ?? ''}
            onChange={v => onChange(setProducer(value, 'linger.ms', v))} />
          <KvField label="batch.size" name="batch.size"
            value={value.producerConfig['batch.size'] ?? ''}
            onChange={v => onChange(setProducer(value, 'batch.size', v))} />
          <KvField label="compression.type" name="compression.type"
            value={value.producerConfig['compression.type'] ?? ''}
            onChange={v => onChange(setProducer(value, 'compression.type', v))} />
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-3">Consumer</div>
        <div className="grid grid-cols-2 gap-3">
          <KvField label="group.id" name="group.id"
            value={value.consumerConfig['group.id'] ?? ''}
            onChange={v => onChange(setConsumer(value, 'group.id', v))} />
          <KvField label="auto.offset.reset" name="auto.offset.reset"
            value={value.consumerConfig['auto.offset.reset'] ?? ''}
            onChange={v => onChange(setConsumer(value, 'auto.offset.reset', v))} />
          <KvField label="fetch.max.wait.ms" name="fetch.max.wait.ms"
            value={value.consumerConfig['fetch.max.wait.ms'] ?? ''}
            onChange={v => onChange(setConsumer(value, 'fetch.max.wait.ms', v))} />
          <KvField label="max.partition.fetch.bytes" name="max.partition.fetch.bytes"
            value={value.consumerConfig['max.partition.fetch.bytes'] ?? ''}
            onChange={v => onChange(setConsumer(value, 'max.partition.fetch.bytes', v))} />
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-3">Topic</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-slate-400 uppercase tracking-wide">Replication Factor</Label>
            <Input className="mt-1 bg-slate-900 border-slate-700 text-slate-100" type="number"
              value={value.replicationFactor}
              onChange={e => onChange({ ...value, replicationFactor: Number(e.target.value) })} />
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd frontend && npm run build && cd ..
git add frontend/src/pages/NewRun/DriverForm.tsx
git commit -m "feat: DriverForm for driver YAML fields"
```

---

## Task 15: YAML Editor + ConfigEditor Split View

**Files:**
- Create: `frontend/src/pages/NewRun/YamlEditor.tsx`
- Create: `frontend/src/pages/NewRun/ConfigEditor.tsx`

- [ ] **Step 1: Create frontend/src/pages/NewRun/YamlEditor.tsx**

```tsx
import CodeMirror from '@uiw/react-codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { oneDark } from '@codemirror/theme-one-dark'

interface Props {
  value: string
  onChange: (val: string) => void
  readOnly?: boolean
}

export default function YamlEditor({ value, onChange, readOnly }: Props) {
  return (
    <CodeMirror
      value={value}
      extensions={[yaml()]}
      theme={oneDark}
      readOnly={readOnly}
      onChange={onChange}
      className="text-xs border border-slate-700 rounded overflow-hidden h-full"
      basicSetup={{ lineNumbers: true, foldGutter: true }}
    />
  )
}
```

- [ ] **Step 2: Create frontend/src/pages/NewRun/ConfigEditor.tsx**

```tsx
import { useState, useCallback } from 'react'
import jsYaml from 'js-yaml'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import DriverForm from './DriverForm'
import WorkloadForm from './WorkloadForm'
import YamlEditor from './YamlEditor'
import type { DriverConfig, WorkloadConfig } from '@/api/types'

interface Props {
  driver: DriverConfig
  workload: WorkloadConfig
  onDriverChange: (d: DriverConfig) => void
  onWorkloadChange: (w: WorkloadConfig) => void
}

function toDriverYaml(d: DriverConfig): string {
  const sections = ['topicConfig','commonConfig','producerConfig','consumerConfig'] as const
  const raw: Record<string, unknown> = {
    driverClass: d.driverClass,
    replicationFactor: d.replicationFactor,
    reset: d.reset,
  }
  for (const s of sections) {
    const kv = d[s]
    raw[s] = Object.entries(kv).map(([k,v]) => `${k}=${v}`).join('\n') + (Object.keys(kv).length ? '\n' : '')
  }
  return jsYaml.dump(raw, { lineWidth: -1 })
}

function fromDriverYaml(text: string): DriverConfig | null {
  try {
    const data = jsYaml.load(text) as Record<string, unknown>
    const parseKv = (block: unknown): Record<string,string> => {
      const result: Record<string,string> = {}
      for (const line of String(block ?? '').split('\n')) {
        const eq = line.indexOf('=')
        if (eq > 0) result[line.slice(0,eq).trim()] = line.slice(eq+1).trim()
      }
      return result
    }
    return {
      driverClass: String(data.driverClass ?? ''),
      replicationFactor: Number(data.replicationFactor ?? 3),
      reset: Boolean(data.reset ?? true),
      topicConfig: parseKv(data.topicConfig),
      commonConfig: parseKv(data.commonConfig),
      producerConfig: parseKv(data.producerConfig),
      consumerConfig: parseKv(data.consumerConfig),
    }
  } catch { return null }
}

export default function ConfigEditor({ driver, workload, onDriverChange, onWorkloadChange }: Props) {
  const [driverYaml, setDriverYaml] = useState(() => toDriverYaml(driver))
  const [workloadYaml, setWorkloadYaml] = useState(() => jsYaml.dump(workload, { lineWidth: -1 }))

  const handleDriverFormChange = useCallback((d: DriverConfig) => {
    onDriverChange(d)
    setDriverYaml(toDriverYaml(d))
  }, [onDriverChange])

  const handleDriverYamlChange = useCallback((text: string) => {
    setDriverYaml(text)
    const parsed = fromDriverYaml(text)
    if (parsed) onDriverChange(parsed)
  }, [onDriverChange])

  const handleWorkloadFormChange = useCallback((w: WorkloadConfig) => {
    onWorkloadChange(w)
    setWorkloadYaml(jsYaml.dump(w, { lineWidth: -1 }))
  }, [onWorkloadChange])

  const handleWorkloadYamlChange = useCallback((text: string) => {
    setWorkloadYaml(text)
    try {
      const parsed = jsYaml.load(text) as WorkloadConfig
      if (parsed && typeof parsed === 'object') onWorkloadChange(parsed)
    } catch { /* ignore invalid YAML mid-edit */ }
  }, [onWorkloadChange])

  return (
    <Tabs defaultValue="workload" className="h-full flex flex-col">
      <TabsList className="bg-slate-800 border-b border-slate-700">
        <TabsTrigger value="workload" className="data-[state=active]:bg-slate-700">Workload</TabsTrigger>
        <TabsTrigger value="driver" className="data-[state=active]:bg-slate-700">Driver</TabsTrigger>
      </TabsList>

      <TabsContent value="workload" className="flex-1 grid grid-cols-2 gap-4 mt-0 min-h-0">
        <div className="overflow-y-auto pr-2">
          <WorkloadForm value={workload} onChange={handleWorkloadFormChange} />
        </div>
        <div className="min-h-0">
          <YamlEditor value={workloadYaml} onChange={handleWorkloadYamlChange} />
        </div>
      </TabsContent>

      <TabsContent value="driver" className="flex-1 grid grid-cols-2 gap-4 mt-0 min-h-0">
        <div className="overflow-y-auto pr-2">
          <DriverForm value={driver} onChange={handleDriverFormChange} />
        </div>
        <div className="min-h-0">
          <YamlEditor value={driverYaml} onChange={handleDriverYamlChange} />
        </div>
      </TabsContent>
    </Tabs>
  )
}
```

- [ ] **Step 3: Build and verify no TypeScript errors**

```bash
cd frontend && npm run build 2>&1 | tail -20
```
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/NewRun/
git commit -m "feat: YamlEditor + ConfigEditor split-view with two-way sync"
```

---

## Task 16: LiveRun Component

**Files:**
- Create: `frontend/src/pages/NewRun/LiveRun.tsx`

- [ ] **Step 1: Create frontend/src/pages/NewRun/LiveRun.tsx**

```tsx
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api } from '@/api/client'

interface Props {
  runId: number
  warmupMinutes: number
  testMinutes: number
  onComplete: () => void
  onStop: () => void
}

export default function LiveRun({ runId, warmupMinutes, testMinutes, onComplete, onStop }: Props) {
  const [lines, setLines] = useState<string[]>([])
  const [done, setDone] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const logRef = useRef<HTMLDivElement>(null)
  const totalSeconds = (warmupMinutes + testMinutes) * 60

  // WebSocket for log lines
  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.host}/ws/runs/${runId}`)
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'done') { setDone(true); onComplete() }
      } catch {
        setLines(prev => [...prev.slice(-499), e.data])
      }
    }
    ws.onerror = () => setDone(true)
    return () => ws.close()
  }, [runId, onComplete])

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [lines])

  // Elapsed timer
  useEffect(() => {
    if (done) return
    const t = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [done])

  const progress = Math.min((elapsed / totalSeconds) * 100, 100)
  const fmt = (s: number) => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`

  const handleStop = async () => {
    await api.stopRun(runId)
    onStop()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-400">
          {done ? '✅ Complete' : `⏱ ${fmt(elapsed)} / ${fmt(totalSeconds)}`}
        </div>
        {!done && (
          <Button variant="destructive" size="sm" onClick={handleStop}>Stop</Button>
        )}
      </div>

      {/* Progress bar */}
      <div className="bg-slate-800 rounded-full h-2">
        <div
          className="bg-indigo-500 h-2 rounded-full transition-all duration-1000"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="text-xs text-slate-500">{progress.toFixed(0)}% complete</div>

      {/* Log tail */}
      <div
        ref={logRef}
        className="bg-slate-950 border border-slate-700 rounded p-3 h-96 overflow-y-auto font-mono text-xs text-slate-300 space-y-0.5"
      >
        {lines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
        ))}
        {!done && <div className="text-slate-600 animate-pulse">▌</div>}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd frontend && npm run build && cd ..
git add frontend/src/pages/NewRun/LiveRun.tsx
git commit -m "feat: LiveRun component with WebSocket log tail and progress bar"
```

---

## Task 17: NewRun Page

**Files:**
- Create: `frontend/src/pages/NewRun/index.tsx`
- Create placeholder stubs: `frontend/src/pages/Results/index.tsx`, `frontend/src/pages/RunDetail/index.tsx`

- [ ] **Step 1: Create placeholder pages**

Create `frontend/src/pages/Results/index.tsx`:
```tsx
export default function ResultsPage() {
  return <div className="text-slate-400">Results — coming in Task 18</div>
}
```

Create `frontend/src/pages/RunDetail/index.tsx`:
```tsx
export default function RunDetailPage() {
  return <div className="text-slate-400">Run detail — coming in Task 19</div>
}
```

- [ ] **Step 2: Create frontend/src/pages/NewRun/index.tsx**

```tsx
import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/api/client'
import type { DriverConfig, WorkloadConfig } from '@/api/types'
import ConfigEditor from './ConfigEditor'
import LiveRun from './LiveRun'

const DEFAULT_DRIVER: DriverConfig = {
  driverClass: 'io.openmessaging.benchmark.driver.redpanda.RedpandaBenchmarkDriver',
  replicationFactor: 3, reset: true,
  topicConfig: {}, commonConfig: {}, producerConfig: {}, consumerConfig: {},
}
const DEFAULT_WORKLOAD: WorkloadConfig = {
  topics: 1, partitionsPerTopic: 10, messageSize: 1024,
  payloadFile: 'payload/payload-1Kb.data', subscriptionsPerTopic: 1,
  consumerPerSubscription: 1, producersPerTopic: 10, producerRate: 10000,
  consumerBacklogSizeGB: 0, testDurationMinutes: 20, warmupDurationMinutes: 5,
}

export default function NewRunPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [runName, setRunName] = useState('')
  const [driver, setDriver] = useState<DriverConfig>(DEFAULT_DRIVER)
  const [workload, setWorkload] = useState<WorkloadConfig>(DEFAULT_WORKLOAD)
  const [activeRunId, setActiveRunId] = useState<number | null>(null)

  // Load current config from disk on mount
  useQuery({
    queryKey: ['config'],
    queryFn: api.getConfig,
    onSuccess: (data) => {
      setDriver(data.driver)
      setWorkload(data.workload)
    },
  })

  const saveMutation = useMutation({
    mutationFn: () => api.putConfig({ driver, workload }),
  })

  const runMutation = useMutation({
    mutationFn: async () => {
      await api.putConfig({ driver, workload })
      return api.createRun(runName || undefined)
    },
    onSuccess: (run) => setActiveRunId(run.id),
  })

  const handleComplete = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['runs'] })
  }, [queryClient])

  const handleStop = useCallback(() => {
    setActiveRunId(null)
    queryClient.invalidateQueries({ queryKey: ['runs'] })
  }, [queryClient])

  if (activeRunId !== null) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Run #{activeRunId} in progress</h1>
          <Button variant="outline" size="sm" onClick={() => navigate(`/runs/${activeRunId}`)}>
            View Details →
          </Button>
        </div>
        <LiveRun
          runId={activeRunId}
          warmupMinutes={workload.warmupDurationMinutes}
          testMinutes={workload.testDurationMinutes}
          onComplete={handleComplete}
          onStop={handleStop}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between flex-shrink-0">
        <h1 className="text-xl font-semibold">New Run</h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Label className="text-slate-400 text-sm">Label (optional)</Label>
            <Input className="w-48 bg-slate-900 border-slate-700 h-8"
              placeholder="e.g. batch=64k linger=5ms"
              value={runName} onChange={e => setRunName(e.target.value)} />
          </div>
          <Button variant="outline" size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving…' : 'Save Config'}
          </Button>
          <Button size="sm"
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            className="bg-indigo-600 hover:bg-indigo-500">
            {runMutation.isPending ? 'Starting…' : '▶ Run'}
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <ConfigEditor
          driver={driver}
          workload={workload}
          onDriverChange={setDriver}
          onWorkloadChange={setWorkload}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Build and verify**

```bash
cd frontend && npm run build 2>&1 | grep -E "error|warning|built"
```
Expected: "built in Xs" with no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/
git commit -m "feat: NewRun page — config editor, run launcher, live run view"
```

---

## Task 18: Results Page + RunTable

**Files:**
- Modify: `frontend/src/pages/Results/index.tsx`
- Create: `frontend/src/pages/Results/RunTable.tsx`

- [ ] **Step 1: Create frontend/src/pages/Results/RunTable.tsx**

```tsx
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import type { RunListItem } from '@/api/types'

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: 'bg-emerald-900 text-emerald-300',
    running: 'bg-indigo-900 text-indigo-300 animate-pulse',
    failed: 'bg-red-900 text-red-300',
    pending: 'bg-slate-700 text-slate-300',
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
              <td className="px-4 py-3 text-slate-200">{run.name ?? <span className="text-slate-500">—</span>}</td>
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

- [ ] **Step 2: Update frontend/src/pages/Results/index.tsx**

```tsx
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import RunTable from './RunTable'

export default function ResultsPage() {
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['runs'],
    queryFn: api.listRuns,
    refetchInterval: 5000,
  })

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Results</h1>
      {isLoading
        ? <div className="text-slate-400">Loading…</div>
        : <RunTable runs={runs} />
      }
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
cd frontend && npm run build && cd ..
git add frontend/src/pages/Results/
git commit -m "feat: Results page with sortable run table"
```

---

## Task 19: Run Detail Page

**Files:**
- Modify: `frontend/src/pages/RunDetail/index.tsx`
- Create: `frontend/src/pages/RunDetail/MetricsTiles.tsx`
- Create: `frontend/src/pages/RunDetail/LatencyBars.tsx`

- [ ] **Step 1: Create frontend/src/pages/RunDetail/MetricsTiles.tsx**

```tsx
import type { Metrics } from '@/api/types'

interface TileProps { label: string; value: string; color?: string }

function Tile({ label, value, color = 'text-emerald-400' }: TileProps) {
  return (
    <div className="bg-slate-900 rounded-lg p-4 text-center">
      <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
    </div>
  )
}

function fmt(v: number | null | undefined, decimals = 1) {
  return v != null ? v.toFixed(decimals) : '—'
}

export default function MetricsTiles({ metrics }: { metrics: Metrics }) {
  const rate = metrics.publish_rate_avg != null
    ? `${Math.round(metrics.publish_rate_avg).toLocaleString()}/s` : '—'
  return (
    <div className="grid grid-cols-4 gap-4">
      <Tile label="Publish Rate" value={rate} />
      <Tile label="p99 Latency" value={`${fmt(metrics.publish_latency_p99)}ms`}
        color={metrics.publish_latency_p99 != null && metrics.publish_latency_p99 < 5 ? 'text-emerald-400' : 'text-amber-400'} />
      <Tile label="p99.9 Latency" value={`${fmt(metrics.publish_latency_p999)}ms`} color="text-amber-400" />
      <Tile label="Avg E2E" value={`${fmt(metrics.end_to_end_latency_avg)}ms`} />
    </div>
  )
}
```

- [ ] **Step 2: Create frontend/src/pages/RunDetail/LatencyBars.tsx**

```tsx
import type { Metrics } from '@/api/types'

const PERCENTILES: Array<{ key: keyof Metrics; label: string }> = [
  { key: 'publish_latency_p50', label: 'p50' },
  { key: 'publish_latency_p75', label: 'p75' },
  { key: 'publish_latency_p95', label: 'p95' },
  { key: 'publish_latency_p99', label: 'p99' },
  { key: 'publish_latency_p999', label: 'p99.9' },
  { key: 'publish_latency_p9999', label: 'p99.99' },
  { key: 'publish_latency_max', label: 'max' },
]

function barColor(pct: number, max: number): string {
  const ratio = pct / max
  if (ratio < 0.5) return 'bg-indigo-500'
  if (ratio < 0.75) return 'bg-amber-500'
  return 'bg-red-500'
}

export default function LatencyBars({ metrics }: { metrics: Metrics }) {
  const values = PERCENTILES.map(p => ({ label: p.label, val: metrics[p.key] as number | null }))
  const maxVal = Math.max(...values.map(v => v.val ?? 0), 1)

  return (
    <div className="space-y-2">
      <div className="text-xs text-slate-500 uppercase tracking-wider mb-3">Publish Latency Distribution</div>
      {values.map(({ label, val }) => (
        <div key={label} className="flex items-center gap-3 text-sm">
          <span className="w-12 text-right text-slate-500 text-xs">{label}</span>
          <div className="flex-1 bg-slate-800 rounded h-4 overflow-hidden">
            <div
              className={`h-full rounded transition-all ${barColor(val ?? 0, maxVal)}`}
              style={{ width: `${((val ?? 0) / maxVal) * 100}%` }}
            />
          </div>
          <span className="w-16 text-right font-mono text-xs text-slate-300">
            {val != null ? `${val.toFixed(2)}ms` : '—'}
          </span>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Update frontend/src/pages/RunDetail/index.tsx**

```tsx
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { api } from '@/api/client'
import MetricsTiles from './MetricsTiles'
import LatencyBars from './LatencyBars'

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>()
  const runId = Number(id)

  const { data: run, isLoading } = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.getRun(runId),
    refetchInterval: (data) => data?.status === 'running' ? 3000 : false,
  })

  if (isLoading) return <div className="text-slate-400">Loading…</div>
  if (!run) return <div className="text-red-400">Run not found</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Run #{run.id} {run.name ? `— ${run.name}` : ''}</h1>
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

      {run.metrics && (
        <>
          <MetricsTiles metrics={run.metrics} />
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-5">
            <LatencyBars metrics={run.metrics} />
          </div>
        </>
      )}

      {run.status === 'running' && (
        <div className="bg-indigo-900/30 border border-indigo-700 rounded-lg p-4 text-indigo-300 text-sm">
          Run in progress — metrics will appear when complete.
        </div>
      )}

      {/* Config snapshot */}
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

- [ ] **Step 4: Build and verify**

```bash
cd frontend && npm run build 2>&1 | grep -E "error|built"
```
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/RunDetail/
git commit -m "feat: RunDetail page — metrics tiles, latency bars, config snapshot"
```

---

## Task 20: End-to-End Smoke Test

- [ ] **Step 1: Create a .env pointing at a mock OMB dir**

```bash
mkdir -p /tmp/mock-omb/bin /tmp/mock-omb/payload
# Create a mock benchmark script that outputs a result JSON
cat > /tmp/mock-omb/bin/benchmark << 'EOF'
#!/usr/bin/env bash
echo "Starting OMB mock run..."
sleep 2
echo "Warmup complete."
sleep 1
echo "Test complete."
# Write a mock result file
cat > /tmp/mock-omb/workload-Redpanda-$(date +%Y-%m-%d-%H-%M-%S).json << 'ENDJSON'
{"driver":"Redpanda","messageSize":1024,"topics":1,"partitions":10,
"sampleRateMillis":10000,"publishRate":[10000.0,10000.0],
"consumeRate":[10000.0,10000.0],"backlog":[0,0],
"aggregatedPublishLatencyAvg":8.0,"aggregatedPublishLatency50pct":8.0,
"aggregatedPublishLatency75pct":10.0,"aggregatedPublishLatency95pct":12.0,
"aggregatedPublishLatency99pct":14.0,"aggregatedPublishLatency999pct":16.0,
"aggregatedPublishLatency9999pct":20.0,"aggregatedPublishLatencyMax":30.0,
"aggregatedEndToEndLatencyAvg":9.0,"aggregatedEndToEndLatency50pct":9.0,
"aggregatedEndToEndLatency75pct":11.0,"aggregatedEndToEndLatency95pct":13.0,
"aggregatedEndToEndLatency99pct":15.0,"aggregatedEndToEndLatency999pct":20.0,
"aggregatedEndToEndLatency9999pct":100.0,"aggregatedEndToEndLatencyMax":200.0}
ENDJSON
EOF
chmod +x /tmp/mock-omb/bin/benchmark

# Create minimal YAML files
echo "driverClass: io.openmessaging.benchmark.driver.redpanda.RedpandaBenchmarkDriver
replicationFactor: 3
reset: true
commonConfig: |
  bootstrap.servers=localhost:9092" > /tmp/mock-omb/driver.yaml

echo "topics: 1
partitionsPerTopic: 10
messageSize: 1024
payloadFile: payload/p.data
subscriptionsPerTopic: 1
consumerPerSubscription: 1
producersPerTopic: 10
producerRate: 10000
consumerBacklogSizeGB: 0
testDurationMinutes: 1
warmupDurationMinutes: 1" > /tmp/mock-omb/workload.yaml

echo "OMB_DIR=/tmp/mock-omb
PROMETHEUS_URL=http://localhost:9644
ANTHROPIC_API_KEY=test" > .env
```

- [ ] **Step 2: Run the full test suite**

```bash
pytest tests/ -v
```
Expected: All tests pass.

- [ ] **Step 3: Start the server and verify the UI works end-to-end**

```bash
uvicorn backend.main:app --port 8080 &
sleep 2

# Check config endpoint loads from disk
curl -s http://localhost:8080/api/config | python3 -m json.tool | grep bootstrap

# Start a run
RUN_ID=$(curl -s -X POST http://localhost:8080/api/runs \
  -H "Content-Type: application/json" \
  -d '{"name":"smoke-test"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Run ID: $RUN_ID"

# Wait for completion
sleep 8
curl -s http://localhost:8080/api/runs/$RUN_ID | python3 -c \
  "import sys,json; r=json.load(sys.stdin); print('status:', r['status'], '| p99:', r.get('metrics',{}).get('publish_latency_p99'))"

kill %1
```
Expected output:
```
"bootstrap.servers": "localhost:9092"
Run ID: 1
status: completed | p99: 14.0
```

- [ ] **Step 4: Open the React UI in a browser**

```bash
# Start server (serves pre-built React SPA)
uvicorn backend.main:app --host 0.0.0.0 --port 8080
```

Open `http://localhost:8080` in a browser. Verify:
- Sidebar shows New Run / Results links
- New Run page loads with config editor (Driver + Workload tabs)
- Rate calculator updates when you change producerRate or messageSize
- YAML pane updates when you change form fields
- "▶ Run" button starts a run and shows live log output
- After run completes, "View Details →" shows metrics tiles and latency bars
- Results page shows the run in the table

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat: Phase 1 complete — config editor, run lifecycle, results UI"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Config editor (split-view form + YAML, Driver + Workload tabs) — Tasks 13–15
- ✅ "Clone from run #N" — partially: loads from disk on mount; full clone from past run not yet implemented → **add to Phase 1 backlog or Phase 2**
- ✅ Run button launches OMB — Task 8, 17
- ✅ Live log streaming over WebSocket — Tasks 5, 9, 16
- ✅ Progress bar with elapsed/total — Task 16
- ✅ Stop button — Task 8, 16
- ✅ Results table — Task 18
- ✅ Run detail with metrics — Task 19
- ✅ Latency bars with inline values — Task 19
- ✅ Config snapshot on run detail — Task 19
- ✅ Expected rate calculator — Task 13
- ✅ OMB JSON result parsing — Task 4
- ✅ SQLite storage — Task 2
- ✅ YAML read/write from OMB_DIR — Task 3
- ⏳ Charts (throughput over time) — Phase 2
- ⏳ Prometheus metrics — Phase 2
- ⏳ Sweep runner — Phase 3
- ⏳ AI chat — Phase 4

**Note on "Clone from run #N":** The NewRun page loads the current on-disk config on mount. To clone from an arbitrary past run, add a "Clone" button to RunDetail that calls `PUT /api/config` with the run's snapshot and navigates to `/runs/new`. This is a single-task addition that can slot into Phase 1 before Phase 2 begins.
