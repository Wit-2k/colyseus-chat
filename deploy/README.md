# 部署说明（云主机）

## 服务器上的布局

| 东西           | 位置                                                            |
| -------------- | --------------------------------------------------------------- |
| nginx 容器     | `test-web`（已存在，发布 80/443，挂载 `/etc/letsencrypt` 证书） |
| nginx 站点配置 | 主机 `/root/nginx-conf/` → 容器 `/etc/nginx/conf.d/`            |
| 应用容器       | `chat-server`，由本仓库的 `Dockerfile` 构建                     |
| 共享网络       | `chat-net`（nginx 和应用容器都接上，nginx 才能用容器名访问它）  |

前端页面**不在** nginx 里：Colyseus 自己托管 `client/dist`（见 `server/src/app.config.ts`），
所以 nginx 只是把整站流量转发给应用容器。

## 首次部署

在云主机上（仓库目录里）：

```bash
# 1. 拉代码
git clone https://github.com/Wit-2k/colyseus-chat.git    # 国内直连若报 HTTP2 framing layer 错误，先执行
                                                          # git config --global http.version HTTP/1.1
cd colyseus-chat

# 2. 构建镜像（镜像里会跑 shared → server → client 三端构建）
docker build -t colyseus-chat .

# 3. 让 nginx 和应用容器在同一个网络里（只需做一次）
docker network create chat-net
docker network connect chat-net test-web

# 4. 起应用容器（不对外暴露端口，只让 nginx 通过容器名访问）
docker run -d --name chat-server --network chat-net --restart unless-stopped colyseus-chat

# 5. 换上仓库里的站点配置，然后 reload
cp deploy/nginx/go-comm.space.conf /root/nginx-conf/default.conf
docker exec test-web nginx -t && docker exec test-web nginx -s reload
```

## 更新已部署的版本

```bash
cd colyseus-chat
git pull
docker build -t colyseus-chat .
docker rm -f chat-server
docker run -d --name chat-server --network chat-net --restart unless-stopped colyseus-chat
```

## 验收

- `https://go-comm.space` 能打开聊天页面，两个浏览器标签能互相看到消息；
- 本仓库 `access/ConnectionTest.ts` 可以快速验证域名是否可访问：
  `bun run access/ConnectionTest.ts go-comm.space`
- 容器日志：`docker logs -f chat-server`
