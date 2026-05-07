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
