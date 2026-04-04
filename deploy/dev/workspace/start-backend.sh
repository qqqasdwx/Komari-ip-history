#!/bin/sh
set -eu

cd /workspace
mkdir -p /root/.tmp
if [ -f /root/.tmp/ipq-backend.pid ]; then
  OLD_PID="$(cat /root/.tmp/ipq-backend.pid 2>/dev/null || true)"
  if [ -n "${OLD_PID}" ] && kill -0 "${OLD_PID}" 2>/dev/null; then
    kill "${OLD_PID}" >/dev/null 2>&1 || true
    sleep 1
  fi
fi
rm -f /root/.tmp/ipq-backend.pid /root/.tmp/ipq-backend-bin
go build -o /root/.tmp/ipq-backend-bin ./cmd/ipq
nohup /root/.tmp/ipq-backend-bin >/tmp/ipq-backend.log 2>&1 &
echo $! >/root/.tmp/ipq-backend.pid
echo "backend started, log: /tmp/ipq-backend.log"
