#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="omb-ui"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
CURRENT_USER="$(whoami)"

cd "$SCRIPT_DIR"

# --- .env setup ---
if [ ! -f .env ]; then
  echo ""
  echo "No .env file found. Creating one now."
  echo ""
  read -rp "OMB_DIR [/opt/benchmark]: " OMB_DIR_INPUT
  OMB_DIR_VAL="${OMB_DIR_INPUT:-/opt/benchmark}"

  read -rp "Broker address (bootstrap.servers): " BROKER_INPUT

  read -rp "PROMETHEUS_URL [http://localhost:9644]: " PROM_INPUT
  PROM_VAL="${PROM_INPUT:-http://localhost:9644}"

  read -rp "Prometheus username [prometheus]: " PROM_USER_INPUT
  PROM_USER_VAL="${PROM_USER_INPUT:-prometheus}"

  read -rsp "Prometheus password: " PROM_PASS_INPUT
  echo ""

  read -rp "SASL username (leave blank if not using SASL): " SASL_USER_INPUT

  read -rsp "SASL password: " SASL_PASS_INPUT
  echo ""

  read -rp "ANTHROPIC_API_KEY (optional, leave blank to skip): " ANTHROPIC_INPUT

  cat > .env <<EOF
OMB_DIR=${OMB_DIR_VAL}
BROKER_ADDR=${BROKER_INPUT}
PROMETHEUS_URL=${PROM_VAL}
PROMETHEUS_USERNAME=${PROM_USER_VAL}
PROMETHEUS_PASSWORD=${PROM_PASS_INPUT}
SASL_USERNAME=${SASL_USER_INPUT}
SASL_PASSWORD=${SASL_PASS_INPUT}
ANTHROPIC_API_KEY=${ANTHROPIC_INPUT}
EOF
  echo ".env created."
fi

# --- OMB dir permissions ---
# shellcheck source=.env
set -a; source .env; set +a
if [ -d "${OMB_DIR:-/opt/benchmark}" ]; then
  sudo chown -R "$(whoami)" "${OMB_DIR:-/opt/benchmark}"
fi

# --- Python dependencies ---
echo ""
echo "Installing Python dependencies..."
python3 -m pip install -r requirements.txt -q

# --- Frontend build ---
echo "Building frontend..."
cd frontend
npm install --silent
npm run build --silent
cd ..

# --- systemd service ---
if command -v systemctl &>/dev/null; then
  echo "Installing systemd service..."

  UVICORN_BIN="$(which uvicorn 2>/dev/null || echo 'python3 -m uvicorn')"

  sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=OMB UI
After=network.target

[Service]
WorkingDirectory=${SCRIPT_DIR}
ExecStart=${UVICORN_BIN} backend.main:app --host 0.0.0.0 --port 8888
Restart=on-failure
User=${CURRENT_USER}
EnvironmentFile=${SCRIPT_DIR}/.env

[Install]
WantedBy=multi-user.target
EOF

  sudo systemctl daemon-reload
  sudo systemctl enable "$SERVICE_NAME"
  sudo systemctl restart "$SERVICE_NAME"

  echo ""
  echo "Service status:"
  sudo systemctl status "$SERVICE_NAME" --no-pager -l | head -20
  echo ""
  echo "OMB UI is running at http://localhost:8888"
  echo "Logs: journalctl -u $SERVICE_NAME -f"
else
  echo ""
  echo "systemd not available. Start manually with:"
  echo "  uvicorn backend.main:app --host 0.0.0.0 --port 8888"
fi
