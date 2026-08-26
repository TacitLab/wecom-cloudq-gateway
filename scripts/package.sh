#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
dist_dir="$project_dir/dist"
archive="$dist_dir/wecom-cloudagent-cvm.zip"

mkdir -p "$dist_dir"
rm -f "$archive"

cd "$project_dir"
zip -qr "$archive" server.js src node_modules package.json package-lock.json README.md .env.example Dockerfile docker-compose.yml .dockerignore deploy.sh

echo "$archive"
