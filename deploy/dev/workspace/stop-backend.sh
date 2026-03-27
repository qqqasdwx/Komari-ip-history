#!/bin/sh
set -eu

pkill -f '/tmp/go-build.*/ipq' >/dev/null 2>&1 || true
pkill -f '/root/.cache/go-build/.*/ipq' >/dev/null 2>&1 || true
pkill -f 'go run ./cmd/ipq' >/dev/null 2>&1 || true
echo "backend stopped"
