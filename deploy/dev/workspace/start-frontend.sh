#!/bin/sh
set -eu

cd /workspace/web
pkill -f 'vite --host 0.0.0.0 --port 5173' >/dev/null 2>&1 || true
nohup npm run dev -- --host 0.0.0.0 --port 5173 >/tmp/ipq-frontend.log 2>&1 &
echo "frontend started, log: /tmp/ipq-frontend.log"
