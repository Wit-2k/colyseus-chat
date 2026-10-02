# 生产镜像。分三个阶段：
#
#   deps —— 只装生产依赖。输入只有几份 package.json / bun.lock，**很少变**，
#           所以这一层的缓存能一直复用（依赖在 Linux 里装，平台相关的东西才对）
#   app  —— 把「本机构建好的产物」装进镜像。部署走这条：本机 1 秒构建完，
#           主机只重放几个 COPY 层（秒级），不用在那台 2 核机器上跑 rolldown
#   all  —— 在镜像里从源码完整构建。没有本机构建环境时的兜底，也是默认 target
#           （直接 `docker build -t colyseus-chat .` 走这条）
#
# 部署用：docker build --target app -t colyseus-chat .    （见 scripts/release.mjs）

# ---------- 依赖（很少变）----------
FROM oven/bun:1-slim AS deps
WORKDIR /app
ENV NODE_ENV=production

# --ignore-scripts 跳过根 package.json 里的 "prepare": "vp config"（镜像里不需要 vp 的 git 钩子）
COPY package.json bun.lock bunfig.toml ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN bun install --frozen-lockfile --ignore-scripts --production

# ---------- 装配（部署走这条：上下文里带本机构建好的 artifacts/）----------
FROM deps AS app
COPY artifacts/server/build ./server/build
COPY artifacts/shared/dist ./shared/dist
COPY artifacts/client/dist ./client/dist
EXPOSE 2567
# 用 bun 直接跑编译产物（bun 能跑普通 JS，镜像里不用再装 node）
CMD ["bun", "server/build/index.js"]

# ---------- 完整构建（兜底 / CI）----------
FROM oven/bun:1 AS all
WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock bunfig.toml ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN bun install --frozen-lockfile --ignore-scripts

COPY . .
RUN bun run build

EXPOSE 2567
CMD ["bun", "server/build/index.js"]
