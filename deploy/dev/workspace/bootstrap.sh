#!/bin/sh
set -eu

cd /workspace

git config --global --add safe.directory /workspace

go mod download
cd /workspace/web
npm ci

echo "workspace bootstrap completed"
