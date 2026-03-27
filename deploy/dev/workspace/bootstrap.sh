#!/bin/sh
set -eu

cd /workspace

go mod download
cd /workspace/web
npm ci

echo "workspace bootstrap completed"
