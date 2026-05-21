# OMB UI

A web interface for [OpenMessaging Benchmark (OMB)](https://github.com/redpanda-data/openmessaging-benchmark) that lets you launch benchmark runs, run parameter sweeps, and compare results — all from a browser.

## Features

- **Single runs** — configure workload and driver parameters, start/stop runs, watch live metrics
- **Parameter sweeps** — define axes of values (e.g. `messageSize: [1024, 4096, 16384]`), run the Cartesian product automatically with configurable cooldown between runs
- **Results table** — compare runs by publish rate, p99 latency, p99.9 latency, and end-to-end p99
- **Sweep comparison table** — highlight best/worst per metric across all runs in a sweep
- **Prometheus integration** — pull metrics from a Prometheus endpoint after each run

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
cd ~/omb_ui && git reset --hard origin/main && git pull && bash deploy.sh
```

### Reconfiguring .env

```bash
rm ~/omb_ui/.env && bash ~/omb_ui/deploy.sh
```

### Logs

```bash
journalctl -u omb-ui -f
```

## Usage

### Single Run

1. Navigate to **New Run**
2. Configure the **Workload** (duration, producer rate, message size, partitions) and **Driver** (broker address, SASL credentials, compression, acks) settings
3. Click **Save Config** to persist the settings to disk, or **▶ Run** to save and immediately start a benchmark
4. Watch live output while the run is in progress; results appear in the **Runs** table when complete

### Parameter Sweeps

Sweeps run the Cartesian product of one or more parameter axes automatically, with a configurable cooldown between runs.

1. Navigate to **Sweeps → New Sweep**
2. Set the sweep name and cooldown (seconds between runs)
3. Configure the base **Workload** and **Driver** settings — these apply to every run in the sweep
4. Under **Swept Parameters**, add one or more axes:
   - Enter a parameter name (e.g. `batch.size`) in the left field
   - Type a value and press **Enter** to add it as a chip — repeat for each value to sweep
   - Add more axes with **+ Add parameter**
5. The **Combinations** counter shows how many runs will be created (Cartesian product of all axes)
6. Click **Create Sweep** — runs execute sequentially, and the sweep detail page updates live

**Example:** sweeping `batch.size` over `16384 65536 131072` and `linger.ms` over `1 5` creates 6 runs.

#### Duplicating a sweep

On any sweep detail page, click **Duplicate** to open a pre-populated New Sweep form with all settings copied from that sweep. Adjust whatever you want and create the new sweep.

#### Reading sweep results

The sweep detail table highlights the **best** (green) and **worst** (red) result per metric across all completed runs, making it easy to identify winning configurations at a glance.

## Configuration

`.env` on the worker (created by `deploy.sh`):

```
OMB_DIR=/opt/benchmark
BROKER_ADDR=broker:9092
PROMETHEUS_URL=http://localhost:9644
PROMETHEUS_USERNAME=prometheus
PROMETHEUS_PASSWORD=secret
SASL_USERNAME=myuser
SASL_PASSWORD=mypassword
ANTHROPIC_API_KEY=sk-ant-...   # optional
```

These values pre-populate the UI on first load. You can override them at any time through the **New Run** config form and click **Save Config** — changes are persisted to the worker and used for all subsequent runs and sweeps.

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
