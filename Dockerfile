# 云主机上只有 docker（没有 node/bun），所以后端跑在这个镜像里。
#
# 构建（在云主机上，仓库目录里执行）：
#   docker build -t colyseus-chat .
# 运行：
#   docker run -d --name chat-server --network chat-net --restart unless-stopped colyseus-chat
#
# 镜像里同时装好了前端产物：Colyseus 自己托管 client/dist（同源部署，nginx 只做反代）。
FROM oven/bun:1

WORKDIR /app

# 先只复制依赖清单，让"装依赖"这一层能被 Docker 缓存（改代码时不用重装）
COPY package.json bun.lock ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/

# --ignore-scripts 跳过根 package.json 里的 "prepare": "vp config"（镜像里不需要 vp 的 git 钩子）
RUN bun install --frozen-lockfile --ignore-scripts

# 再复制源码，依次构建 shared（共享协议）→ server（后端）→ client（前端静态文件）
COPY . .
RUN bun run build

ENV NODE_ENV=production
EXPOSE 2567

# 用 bun 直接跑编译产物（bun 能跑普通 JS，镜像里就不用再装一遍 node）
CMD ["bun", "server/build/index.js"]
