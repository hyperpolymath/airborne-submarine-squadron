#!/bin/bash

# Airborne Submarine Squadron Launcher
# Usage: ./launch.sh [port]

PORT=${1:-8000}
DIR=$(dirname "$0")

echo "Starting Airborne Submarine Squadron on port $PORT..."
echo "Open your browser to: http://localhost:$PORT"
echo "Press Ctrl+C to stop the server"
echo ""

cd "$DIR"
python3 -m http.server $PORT
