#!/bin/bash
set -e

COMPOSE_FILE="docker/docker-compose.local.yml"

echo "==> 检查 db.sqlite..."
if [ ! -f db.sqlite ]; then
  touch db.sqlite
  echo "    已创建空 db.sqlite"
fi

echo "==> 拉取最新代码..."
git pull

echo "==> 构建并启动容器..."
docker compose -f "$COMPOSE_FILE" up -d --build

echo "==> 容器状态："
docker compose -f "$COMPOSE_FILE" ps

echo ""
echo "✅ 部署完成"
echo "   前端: http://$(hostname -I | awk '{print $1}'):8080"
echo "   API:  http://$(hostname -I | awk '{print $1}'):60000"
echo "   首次登录: admin / admin123"
