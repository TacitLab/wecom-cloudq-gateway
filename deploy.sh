#!/usr/bin/env bash
set -Eeuo pipefail

project_dir="$(cd "$(dirname "$0")" && pwd)"
cd "$project_dir"

log() {
  printf '[deploy] %s\n' "$*"
}

if [[ ! -f .env ]]; then
  cp .env.example .env
  log "已生成 .env，请先修改 ADMIN_PASSWORD 后重新执行 ./deploy.sh"
  exit 2
fi

if [[ -d .git && "${DEPLOY_SKIP_PULL:-0}" != "1" ]]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    log "检测到未提交的源码修改。为避免覆盖，已停止部署。"
    git status --short
    exit 3
  fi

  branch="$(git branch --show-current)"
  [[ -n "$branch" ]] || { log "当前 Git 处于 detached HEAD，无法自动更新。"; exit 4; }
  before="$(git rev-parse HEAD)"
  log "从 origin/$branch 拉取最新代码"
  git pull --ff-only origin "$branch"
  after="$(git rev-parse HEAD)"

  if [[ "$before" != "$after" ]]; then
    log "代码已更新，使用新版部署脚本继续"
    exec env DEPLOY_SKIP_PULL=1 "$project_dir/deploy.sh"
  fi
fi

if docker info >/dev/null 2>&1; then
  docker_cmd=(docker)
else
  docker_cmd=(sudo docker)
fi

log "校验 Docker Compose 配置"
"${docker_cmd[@]}" compose config --quiet

log "构建并更新网关容器"
"${docker_cmd[@]}" compose up -d --build --remove-orphans

container_id="$("${docker_cmd[@]}" compose ps -q gateway)"
if [[ -z "$container_id" ]]; then
  log "未找到 gateway 容器"
  "${docker_cmd[@]}" compose ps
  exit 5
fi

log "等待健康检查通过"
for _ in $(seq 1 60); do
  state="$("${docker_cmd[@]}" inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
  case "$state" in
    healthy|running)
      log "部署成功"
      "${docker_cmd[@]}" compose ps
      exit 0
      ;;
    unhealthy|exited|dead)
      log "容器状态异常：$state"
      "${docker_cmd[@]}" compose logs --tail=120 gateway
      exit 6
      ;;
  esac
  sleep 2
done

log "等待健康检查超时"
"${docker_cmd[@]}" compose ps
"${docker_cmd[@]}" compose logs --tail=120 gateway
exit 7

