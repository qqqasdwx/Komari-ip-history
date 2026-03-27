#!/bin/sh
set -eu

cd /workspace
pkill -f '/tmp/go-build.*/ipq' >/dev/null 2>&1 || true
pkill -f '/root/.cache/go-build/.*/ipq' >/dev/null 2>&1 || true
pkill -f 'go run ./cmd/ipq' >/dev/null 2>&1 || true
nohup go run ./cmd/ipq >/tmp/ipq-backend.log 2>&1 &
echo "backend started, log: /tmp/ipq-backend.log"
