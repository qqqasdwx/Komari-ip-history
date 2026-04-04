#!/bin/sh
set -eu

cd /workspace
pkill -f '/tmp/go-build.*/ipq' >/dev/null 2>&1 || true
pkill -f '/root/.cache/go-build/.*/ipq' >/dev/null 2>&1 || true
pkill -f 'go run ./cmd/ipq' >/dev/null 2>&1 || true
pkill -f '/tmp/ipq-backend-bin' >/dev/null 2>&1 || true
rm -f /tmp/ipq-backend-bin
go build -o /tmp/ipq-backend-bin ./cmd/ipq
nohup /tmp/ipq-backend-bin >/tmp/ipq-backend.log 2>&1 &
echo "backend started, log: /tmp/ipq-backend.log"
