#!/bin/sh
set -eu

PID_PATH=/workspace/.tmp/ipq-backend.pid

if [ -f "$PID_PATH" ]; then
  PID="$(cat "$PID_PATH" 2>/dev/null || true)"
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" >/dev/null 2>&1 || true
    sleep 1
  fi
  rm -f "$PID_PATH"
fi

pkill -f '/workspace/.tmp/ipq-backend-bin' >/dev/null 2>&1 || true
pkill -f '/tmp/go-build.*/ipq' >/dev/null 2>&1 || true
pkill -f '/root/.cache/go-build/.*/ipq' >/dev/null 2>&1 || true
pkill -f 'go run ./cmd/ipq' >/dev/null 2>&1 || true
echo "backend stopped"
