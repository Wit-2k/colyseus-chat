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

## 日常发布（推荐）：`bun run release`

在**本机**（仓库根目录）执行一条命令即可：

```bash
bun run release     # 稳态约 12 秒
```

它做四件事：

1. **本机构建** shared → server → client（前端构建在本机约 0.4 秒；同样的构建在云主机要 2~6 分钟）；
2. 组装部署上下文：几份 `package.json` + 三份产物（`server/build`、`shared/dist`、`client/dist`），约几百 KB；
3. 通过 WSL 的 ssh 别名 `aliyun` 上传，并在主机上 `docker build --target app`（只重放几个 COPY 层）、
   重启容器、打印冒烟结果；
4. 清理本地临时目录。

实测耗时：**首次 64 秒**（要在主机上重建依赖层，`bun install --production` 17 秒），
**之后 12 秒**（依赖层命中缓存，产物层 0.1~0.2 秒）。

依赖为什么不在本机装好一起传：本机是 Windows、主机是 Linux，`node_modules` 里有平台相关的东西，
所以**依赖在主机镜像里装（有缓存），产物在本机构建**。

## 首次部署

```bash
# ① 主机上一次性准备（网络 + nginx 站点配置）
ssh aliyun
docker network create chat-net
docker network connect chat-net test-web
# 站点配置从本机传上去（或直接从仓库复制）
scp deploy/nginx/go-comm.space.conf aliyun:/root/nginx-conf/default.conf
docker exec test-web nginx -t && docker exec test-web nginx -s reload

# ② 本机发布（仓库根目录）—— 会自动构建、上传、装配镜像、起容器
bun run release
```

> nginx 配置里反代的是 `chat-server:2567`，所以**先起容器再 reload** 才不会 502；
> 顺序颠倒也没关系，`bun run release` 跑完再 `nginx -s reload` 一次即可。
>
> 主机不需要仓库源码：发布走的是「产物上传 + 主机装配」，主机上不跑 `git clone` 也不需要构建工具链
> （这也正好绕开了主机直连 GitHub 不稳的问题）。

## 手动部署 / 兜底（主机上没有本机构建环境时）

在主机上从源码完整构建（`Dockerfile` 的 `all` 阶段，2~6 分钟）：

```bash
cd /root/colyseus-chat
git pull                                  # 直连失败就 git config --global http.version HTTP/1.1
docker build -t colyseus-chat .           # 不带 --target 就是 all（全量构建）
docker rm -f chat-server
docker run -d --name chat-server --network chat-net --restart unless-stopped colyseus-chat
```

## 验收

- `https://go-comm.space` 能打开聊天页面，两个浏览器标签能互相看到消息；
- 本仓库 `access/ConnectionTest.ts` 可以快速验证域名是否可访问：
  `bun run access/ConnectionTest.ts go-comm.space`
- 容器日志：`docker logs -f chat-server`

## 常见问题（这台机器上的网络限制）

**1. 拉不到基础镜像**，报 `docker.io/oven/bun:1: not found`

主机直连 Docker Hub 不通（阿里云加速器里也没有这个镜像）。用可达的镜像源拉一次再打个同名标签就行，
不用改 Dockerfile：

```bash
docker pull docker.m.daocloud.io/oven/bun:1
docker tag docker.m.daocloud.io/oven/bun:1 oven/bun:1
```

**2. `git clone` / `git pull` GitHub 失败**，报 `HTTP2 framing layer` 或 `GnuTLS recv error (-110)`

先试 `git config --global http.version HTTP/1.1`。仍然失败的话，就在本机打包后经 SSH 上传
（排掉 `node_modules`、`dist`、`build`，然后解压到主机 `/root/colyseus-chat`）：

```bash
tar czf repo.tgz --exclude=node_modules --exclude='*/node_modules' \
  --exclude=client/dist --exclude=server/build --exclude=shared/dist .
scp repo.tgz aliyun:/root/ && ssh aliyun 'rm -rf /root/colyseus-chat && mkdir -p /root/colyseus-chat && tar xzf /root/repo.tgz -C /root/colyseus-chat'
```
