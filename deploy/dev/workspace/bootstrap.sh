#!/bin/sh
set -eu

cd /workspace

go mod download
cd /workspace/web
npm install

echo "workspace bootstrap completed"
