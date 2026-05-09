# OMB UI

A web interface for [OpenMessaging Benchmark (OMB)](https://github.com/redpanda-data/openmessaging-benchmark) that lets you launch benchmark runs, run parameter sweeps, and visualize results — all from a browser.

## Features

- **Single runs** — configure workload and driver parameters, start/stop runs, watch live metrics
- **Parameter sweeps** — define axes of values (e.g. `messageSize: [1024, 4096, 16384]`), run the Cartesian product automatically with configurable cooldown between runs
- **Results table** — compare runs by publish rate, p99 latency, p99.9 latency, and end-to-end p99
- **Sweep comparison table** — highlight best/worst per metric across all runs in a sweep
- **Prometheus integration** — pull metrics from a local Prometheus endpoint after each run

## Prerequisites

- Python 3.11+
- Node.js 18+ and npm
- An OMB worker with `benchmark` directory (e.g. `/opt/benchmark`)
- Prometheus scraping the broker (for metric collection)

## Deployment (GCP / Linux)

SSH into the OMB worker and clone the repo:

```bash
ssh -i ~/.ssh/redpanda_gcp ubuntu@<worker-ip>
git clone <repo-url> ~/omb_ui
cd ~/omb_ui
bash deploy.sh
```

### Updating

```bash
ssh -i ~/.ssh/redpanda_gcp ubuntu@<worker-ip>
cd ~/omb_ui && git pull && bash deploy.sh
```

### Dev iteration (rsync from local)

If you're actively developing and want to push local changes without committing:

```bash
WORKER=ubuntu@<worker-ip>

rsync -av --exclude .git --exclude node_modules --exclude __pycache__ \
      --exclude '*.pyc' --exclude omb_ui.db --exclude .env \
      -e "ssh -i ~/.ssh/redpanda_gcp" \
      . $WORKER:~/omb_ui/

ssh -i ~/.ssh/redpanda_gcp $WORKER "cd ~/omb_ui && bash deploy.sh"
```

On first run, the script prompts for three values and creates `.env`:

| Prompt | Default | Description |
|---|---|---|
| `OMB_DIR` | `/opt/benchmark` | Root of the OMB installation |
| `PROMETHEUS_URL` | `http://localhost:9644` | Prometheus endpoint for metric queries |
| `ANTHROPIC_API_KEY` | *(blank)* | Optional — enables AI analysis features |

The script then:
1. Installs Python dependencies (`pip install -r requirements.txt`)
2. Builds the React frontend (`npm install && npm run build`)
3. Installs and starts a systemd service (`omb-ui`) on port 8888

After deploy, the UI is available at **http://\<worker-ip\>:8888**.

### Updating

Pull new code and re-run `deploy.sh` — it skips the `.env` prompt if `.env` already exists:

```bash
git pull
bash deploy.sh
```

### Logs

```bash
journalctl -u omb-ui -f
```

### Manual start (no systemd)

```bash
source .env
uvicorn backend.main:app --host 0.0.0.0 --port 8888
```

## Configuration

`.env` values (created by `deploy.sh`, or copy from the table above):

```
OMB_DIR=/opt/benchmark
PROMETHEUS_URL=http://localhost:9644
ANTHROPIC_API_KEY=sk-ant-...   # optional
```

The UI exposes a **Config** endpoint (`PUT /api/config`) that lets you update the default workload and driver YAML templates through the New Run form without editing files directly.

## Local Development (Mac)

```bash
# Backend
pip install -r requirements.txt
cp .env.example .env        # edit values
uvicorn backend.main:app --reload

# Frontend (separate terminal)
cd frontend
npm install
npm run dev                  # Vite dev server on :5173, proxies /api to :8000
```

Run tests:

```bash
pytest
```

## Architecture

```
frontend/          React + Vite + TanStack Query + Tailwind
backend/
  main.py          FastAPI app, lifespan (DB init, OmbRunner singleton)
  models.py        SQLAlchemy ORM (Run, Sweep)
  schemas.py       Pydantic request/response models
  routers/         config, runs, sweeps, prometheus, websocket
  services/
    omb_runner.py  Subprocess manager for OMB processes
    yaml_io.py     Read/write driver and workload YAML files
    prometheus_client.py  Metric queries after run completion
    result_parser.py      Parse OMB JSON result files
omb_ui.db          SQLite database (auto-created on first start)
```
