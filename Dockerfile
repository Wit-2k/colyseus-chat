# 云主机上只有 docker（没有 node/bun），后端跑在这个镜像里。
# 两阶段构建：build 阶段装齐全依赖并构建三端；runtime 阶段只保留跑起来真正需要的东西
# —— 源码、测试、tsconfig 以及 typescript/vite/mocha/oxlint 这些开发工具都不进最终镜像。
#
# 构建：docker build -t colyseus-chat .
# 运行：docker run -d --name chat-server --network chat-net --restart unless-stopped colyseus-chat

# ---------- 构建阶段 ----------
FROM oven/bun:1 AS build
WORKDIR /app

# 先只复制依赖清单，让"装依赖"这一层能被 Docker 缓存（改代码时不用重装）
COPY package.json bun.lock bunfig.toml ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/

# --ignore-scripts 跳过根 package.json 里的 "prepare": "vp config"（镜像里不需要 vp 的 git 钩子）
RUN bun install --frozen-lockfile --ignore-scripts

# 再复制源码，依次构建 shared（共享协议）→ server（后端）→ client（前端静态文件）
COPY . .
RUN bun run build

# ---------- 运行阶段 ----------
FROM oven/bun:1-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# 只装生产依赖：devDependencies 不会进来
COPY package.json bun.lock bunfig.toml ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN bun install --frozen-lockfile --ignore-scripts --production

# 只复制运行需要的构建产物：
#   server/build —— 后端编译结果（入口）
#   shared/dist  —— 共享协议包（server 通过 workspace 软链引用它）
#   client/dist  —— 前端静态文件（Colyseus 自己托管，同源部署）
COPY --from=build /app/server/build ./server/build
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/client/dist ./client/dist

EXPOSE 2567

# 用 bun 直接跑编译产物（bun 能跑普通 JS，镜像里不用再装 node）
CMD ["bun", "server/build/index.js"]
