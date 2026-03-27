#!/bin/sh
set -eu

pkill -f 'vite --host 0.0.0.0 --port 5173' >/dev/null 2>&1 || true
echo "frontend stopped"
