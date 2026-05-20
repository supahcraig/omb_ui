# OMB UI

A web interface for [OpenMessaging Benchmark (OMB)](https://github.com/redpanda-data/openmessaging-benchmark) that lets you launch benchmark runs, run parameter sweeps, and visualize results — all from a browser.

## Features

- **Single runs** — configure workload and driver parameters, start/stop runs, watch live metrics
- **Parameter sweeps** — define axes of values (e.g. `messageSize: [1024, 4096, 16384]`), run the Cartesian product automatically with configurable cooldown between runs
- **Results table** — compare runs by publish rate, p99 latency, p99.9 latency, and end-to-end p99
- **Sweep comparison table** — highlight best/worst per metric across all runs in a sweep
- **Prometheus integration** — pull metrics from a local Prometheus endpoint after each run

## Prerequisites

- An OMB worker running Ubuntu 22.04
- Prometheus scraping the broker (for metric collection)
- Port 8888 open in your firewall/security group

Everything else (Python, Node.js, npm) is handled by `setup.sh`.

## Deployment (GCP / Linux)

### Fresh install

From your local machine, run `setup.sh` via curl — this installs system prerequisites and clones the repo:

```bash
ssh -i ~/.ssh/redpanda_gcp ubuntu@<worker-ip> \
  "curl -fsSL https://raw.githubusercontent.com/supahcraig/omb_ui/main/setup.sh | bash"
```

Then SSH in and run `deploy.sh` interactively to configure `.env`:

```bash
ssh -i ~/.ssh/redpanda_gcp ubuntu@<worker-ip>
bash ~/omb_ui/deploy.sh
```

`deploy.sh` will prompt for these values:

| Prompt | Default | Description |
|---|---|---|
| `OMB_DIR` | `/opt/benchmark` | Root of the OMB installation |
| `BROKER_ADDR` | *(blank)* | Kafka bootstrap.servers address |
| `PROMETHEUS_URL` | `http://localhost:9644` | Prometheus endpoint for metric queries |
| `PROMETHEUS_USERNAME` | `prometheus` | Prometheus basic auth username |
| `PROMETHEUS_PASSWORD` | *(blank)* | Prometheus basic auth password |
| `SASL_USERNAME` | *(blank)* | SASL username (leave blank if not using SASL) |
| `SASL_PASSWORD` | *(blank)* | SASL password |
| `ANTHROPIC_API_KEY` | *(blank)* | Optional — enables AI analysis features |

After deploy, the UI is available at **http://\<worker-ip\>:8888**.

### Updating

```bash
ssh -i ~/.ssh/redpanda_gcp ubuntu@<worker-ip>
cd ~/omb_ui && git pull && bash deploy.sh
```

### Dev iteration (rsync from local)

Push local changes to the worker without committing:

```bash
WORKER=ubuntu@<worker-ip>

rsync -av --exclude .git --exclude node_modules --exclude __pycache__ \
      --exclude '*.pyc' --exclude omb_ui.db --exclude .env \
      -e "ssh -i ~/.ssh/redpanda_gcp" \
      . $WORKER:~/omb_ui/

ssh -i ~/.ssh/redpanda_gcp $WORKER "cd ~/omb_ui && bash deploy.sh"
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
