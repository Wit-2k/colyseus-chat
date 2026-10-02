#!/usr/bin/env bash
# 临时脚本（用完即删）：把当前仓库打包上传到云主机 /root/colyseus-chat
# 走 ssh 通道（稳定），绕开云主机直连 GitHub 不稳的问题。
set -euo pipefail

SRC=/mnt/d/WebDev/colyseus-chat
HOST=aliyun

cd "$SRC"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# 排除依赖和构建产物：镜像里会重新装、重新构建
tar czf "$TMP/repo.tgz" \
  --exclude=./node_modules \
  --exclude=./client/node_modules \
  --exclude=./server/node_modules \
  --exclude=./shared/node_modules \
  --exclude=./access \
  --exclude=./client/dist \
  --exclude=./server/build \
  --exclude=./shared/dist \
  .

echo "包大小: $(du -h "$TMP/repo.tgz" | cut -f1)"
scp -q "$TMP/repo.tgz" "$HOST:/root/chat-repo.tgz"

ssh -o BatchMode=yes "$HOST" 'set -e
  cd /root
  rm -rf colyseus-chat
  mkdir colyseus-chat
  tar xzf chat-repo.tgz -C colyseus-chat
  rm -f chat-repo.tgz
  echo "=== 主机上的仓库 ==="
  cd colyseus-chat
  git log --oneline -1
  git status --short | head -5
  echo "=== 目录 ==="
  ls'
