#!/bin/sh
set -eu

cd /workspace
pkill -f '/tmp/go-build.*/ipq' >/dev/null 2>&1 || true
pkill -f '/root/.cache/go-build/.*/ipq' >/dev/null 2>&1 || true
pkill -f 'go run ./cmd/ipq' >/dev/null 2>&1 || true
mkdir -p /workspace/.tmp
pkill -f '/workspace/.tmp/ipq-backend-bin' >/dev/null 2>&1 || true
rm -f /workspace/.tmp/ipq-backend-bin
go build -o /workspace/.tmp/ipq-backend-bin ./cmd/ipq
nohup /workspace/.tmp/ipq-backend-bin >/tmp/ipq-backend.log 2>&1 &
echo "backend started, log: /tmp/ipq-backend.log"
