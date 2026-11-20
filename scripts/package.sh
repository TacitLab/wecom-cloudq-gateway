#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
dist_dir="$project_dir/dist"
archive="$dist_dir/wecom-cloudagent-cvm.zip"

mkdir -p "$dist_dir"
rm -f "$archive"

cd "$project_dir"
npm --prefix web ci
npm --prefix web run build
zip -qr "$archive" server.js src web/dist web/README.md node_modules package.json package-lock.json README.md docs scripts/render-readme.cjs .env.example Dockerfile docker-compose.yml .dockerignore deploy.sh

echo "$archive"
