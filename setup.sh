#!/usr/bin/env bash
set -e

# One-time setup for a fresh Ubuntu worker.
# Installs system prerequisites and clones the repo.
#
# Usage (from the worker):
#   curl -fsSL https://raw.githubusercontent.com/supahcraig/omb_ui/main/setup.sh | bash
#
# Then run deploy.sh interactively to configure .env:
#   bash ~/omb_ui/deploy.sh

REPO_URL="https://github.com/supahcraig/omb_ui.git"
INSTALL_DIR="$HOME/omb_ui"

echo "==> Installing system prerequisites..."
sudo apt-get update -q
sudo apt-get install -y -q python3-pip git

echo "==> Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - >/dev/null
sudo apt-get remove -y nodejs libnode-dev libnode72 2>/dev/null || true
sudo apt-get install -y -q nodejs

echo "Node $(node --version), npm $(npm --version)"

echo "==> Cloning omb_ui..."
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "   Repo already present, pulling latest..."
  git -C "$INSTALL_DIR" pull
else
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

echo ""
echo "==> Setup complete. Run deploy.sh to finish:"
echo ""
echo "    bash ~/omb_ui/deploy.sh"
echo ""
