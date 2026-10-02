# 实现细节

本文说明「这套东西是怎么搭起来的、为什么这么选」。协议本身（消息格式、字段规则、边界行为）
见 [`protocol.md`](protocol.md)。

## 1. 仓库结构

```
.
├── shared/    前后端共享的协议配方（zod 校验 + 长度常量），编译到 shared/dist
├── server/    Colyseus 服务器（房间逻辑、状态同步、托管前端静态文件）
├── client/    Svelte 5 前端
├── deploy/    线上 nginx 配置与部署说明
├── scripts/   本地开发辅助脚本（一键起三个进程）
└── Dockerfile 生产镜像（两阶段构建）
```

monorepo 用 bun workspaces 管理（根 `package.json` 的 `workspaces`）。

## 2. shared：为什么是一个「编译过」的包

`shared/zodSchemas.ts` 是协议的唯一真源，导出 `ChatPayloadSchema`、`JoinOptionsSchema`、
`MAX_MESSAGE_LENGTH`、`MAX_NAME_LENGTH` 以及推导出的类型。`server` 和 `client` 都通过
**包名** `@colyseus-chat/shared` 引用它（workspace 软链）。

它被编译到 `shared/dist`（`bun run --filter @colyseus-chat/shared build`），而不是直接引用源码，原因：

- 线上服务端是用**纯 Node/bun 跑编译产物**，运行时执行不了 `.ts` 源码；
- 如果让 `server` 直接 `import ../shared/zodSchemas.ts`，`tsc` 会把推断出的 `rootDir` 抬到仓库根，
  编译产物就变成 `build/server/src/index.js`、`build/shared/…`，和 `package.json` 的 `main`、
  部署脚本里的入口路径全对不上（这是改造过程中真实踩到的坑）。

因此 `shared` 有自己的 `tsconfig.json`（`declaration: true`，输出 `.js` + `.d.ts`），
`server`/`client` 的 `pre*` 脚本会在构建前先编译它。

## 3. server

### 3.1 状态即广播

```ts
export const ChatMessage = schema({
  sessionId: t.string(),
  name: t.string(),
  text: t.string(),
  timestamp: t.number(),
});
export const MyRoomState = schema({ messages: t.array(ChatMessage) });
```

用的是 `@colyseus/schema` v5 的**函数式 API**（`schema({...})` + `t.array(Child)`），不是装饰器。
聊天记录直接 `this.state.messages.push(new ChatMessage({...}))` —— 写状态就等于广播，
而且后加入者会在初始全量状态里拿到历史，所以**没有**再调 `this.broadcast("chat", …)`：
两条投递路径会让同一条消息重复到达。

历史上限 50 条（`MAX_HISTORY_MESSAGES`），超出后 `shift()` 丢掉最旧的，避免状态无限增长。

### 3.2 校验：为什么不用 `validate()`

Colyseus 0.18 提供 `validate(schema, handler)` 包装器，但它失败时的处理是
`client.leave(CloseCode.WITH_ERROR)`（见 `@colyseus/core` 的 `onData`）——**直接把客户端踢下线**。
对聊天室太重了，所以服务端用 `ChatPayloadSchema.safeParse(payload)`：失败就丢弃 + `console.warn`，
连接保留。客户端也在发送前用同一个配方校验一次，只是提前拦截、省一次网络往返。

### 3.3 昵称与会话

昵称在 `onJoin` 里由 `JoinOptionsSchema` 校验后记进 `private names: Map<sessionId, string>`，
之后每条消息从 map 里取。`onLeave` / `onDispose` 会清理，避免长期占用内存。
昵称非法（缺失/空/超长/非字符串）时退化为 `sessionId`，保证消息里总有可显示的名字。

### 3.4 同源静态托管

`app.config.ts` 的 `express` 里挂了 `express.static(client/dist)`：

```ts
app.use(express.static(fileURLToPath(new URL("../../client/dist", import.meta.url))));
```

用 `import.meta.url` 推导路径，**与启动时的工作目录无关**（开发跑 `src/`、生产跑 `build/` 都能算对）。
开发环境下这一项会因为目录不存在而自然失效（前端在 vite 上跑），生产环境下它前面只可能命中
`/hi`、`/api/*`，其余请求（含 `/`）由它托管。

## 4. client

- **Svelte 5 runes**（`$state` / `$effect`），无额外状态库。
- 房间实例与 DOM 引用用 `$state.raw` 存：第三方类实例被 Svelte 的深层代理包一层会带来兼容与性能问题。
- 历史与实时消息走**同一条代码路径**：

  ```ts
  const callbacks = getStateCallbacks(joined);
  callbacks(joined.state).messages.onAdd((message) => { … }, true);   // immediate = true
  ```

  `immediate = true` 会把已存在的元素先回调一遍（历史），之后每条新增也会触发同一个回调（实时）。

- 往 `$state` 数组里推的是**普通对象快照**，不是 schema 实例：解码出来的实例不需要（也不应该）被
  响应式系统代理。
- 服务端地址的解析顺序：`VITE_SERVER_URL` → 开发环境 `ws://localhost:2567` → 生产环境
  `window.location.origin`。SDK 会把 `https://` 自动换成 `wss://` 并保留路径，所以生产环境不需要额外配置。
- 发送前用 `ChatPayloadSchema.safeParse` 本地校验；输入框 `maxlength` 用的是同一个 `MAX_MESSAGE_LENGTH`。

## 5. 开发流程与质量门禁

| 命令                | 作用                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `bun install`       | 根目录装一次，所有子包共享依赖                                                               |
| `bun run dev`       | `scripts/dev.mjs` 同时起三个进程：shared（tsc --watch）、server（tsx watch）、client（vite） |
| `bun run typecheck` | 三个包的类型检查（含 `svelte-check`）                                                        |
| `bun run test`      | 服务端测试                                                                                   |
| `vp check`          | 格式化 + lint（oxfmt + oxlint 类型感知规则），提交前钩子跑的是 `vp check --fix`              |

`server/tsconfig.json` 里显式写了 `"types": ["node", "mocha"]`：`@types/node` 与 `@types/mocha`
必须能被直接解析，否则 lint 的类型感知规则和干净环境下的 `tsc` 都会找不到全局类型。

### 测试覆盖什么

`server/test/MyRoom.test.ts` 用 `@colyseus/testing` 起**真实服务器**、用**真实 SDK 客户端**连接，
断言的都是外部可观察行为：

1. 消息同步给房间里所有人（含发送者自己），且首尾空白被 trim；
2. 后加入房间的人能直接拿到历史；
3. 非法消息（空白 / 非字符串 / 缺字段 / `null` / 超长）不写进历史；
4. 历史只保留最近 50 条；
5. 没传昵称时用 `sessionId` 兜底。

## 6. 线上拓扑

```
浏览器 ──HTTPS/WSS──▶ nginx 容器（test-web，TLS 终止 + 整站反代）
                          │  chat-net（docker 用户网络，按容器名互访）
                          ▼
                     chat-server 容器（bun 运行 server/build/index.js）
                     ├─ 静态页面 client/dist
                     ├─ POST /matchmake/…（匹配）
                     └─ GET /<processId>/<roomId>?sessionId=…（WebSocket）
```

**为什么是「Colyseus 托管前端 + nginx 只反代」**：Colyseus 的 matchmaking 和 WebSocket
都挂在根路径上，而 nginx 若把 `/` 当静态站，同一路径上「拿页面」和「升级 WebSocket」就没法区分
（升级请求的路径也是 `/`）。让应用自己托管静态文件、nginx 全量转发，就同时消掉了路径冲突和跨域问题。

- nginx 配置：`deploy/nginx/go-comm.space.conf`（`map $http_upgrade` + `proxy_read_timeout 3600s`，
  否则长连接会在空闲 60 秒后被掐断）。
- 容器不对外暴露端口，只接在 `chat-net` 上，由 nginx 通过容器名访问。
- 容器带 `--restart unless-stopped`，重启机器后自动拉起。

### 镜像（三个阶段）

| 阶段   | 做什么                                                                                            | 何时重建                                                   |
| ------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `deps` | 基于 `oven/bun:1-slim`，只 `bun install --production`（输入只有几份 `package.json` / `bun.lock`） | 只有依赖变化时才重建（约 17 秒）                           |
| `app`  | 把**本机构建好的**产物装进去（`server/build`、`shared/dist`、`client/dist`）                      | 每次发布，只重放几个 COPY 层（0.1~0.2 秒）                 |
| `all`  | 在镜像里从源码完整构建三端                                                                        | 兜底 / CI；不带 `--target` 时的默认目标（主机上 2~6 分钟） |

源码、测试、tsconfig 与开发工具（typescript/vite/mocha/oxlint…）都不进最终镜像（1.12 GB → 692 MB）。

### 发布流水线：为什么构建放在本机

```
本机执行 bun run release
  ├─ 1. bun run build                本机构建三端（前端约 0.4 秒）
  ├─ 2. 组装部署上下文                几份 package.json + 三份产物 ≈ 几百 KB
  ├─ 3. 上传 → 主机 docker build --target app → 重启容器 → 冒烟检查
  └─ 4. 清理本地临时目录
```

- 云主机是 2 核小机器，**同样的**前端构建在那里要 2~~6 分钟，在本机只要 0.4 秒 —— 差 300~~1000 倍；
- 但依赖不能跨平台搬（本机 Windows vs 主机 Linux），所以依赖留在主机镜像里装、由 `deps` 层缓存；
- 实测整条发布：**首次 64 秒**（含依赖层重建 17 秒）、**稳态 12 秒**；
- 顺带绕开了主机直连 GitHub 不稳的问题 —— 主机上不需要 `git clone` / `git pull`，也不装构建工具链。

## 7. 三个真实踩坑记录

**① `@types/node` 从未声明过依赖**
本地能过是因为它是 `@types/express` 的传递依赖，碰巧出现在 `node_modules/@types/` 下；
干净环境（Docker）里 `tsc -p tsconfig.build.json` 直接报 `TS2688: Cannot find type definition file for 'node'`。
→ 在 `server/package.json` 显式声明 `@types/node`。

**② bun 的 isolated 布局让 `@colyseus/core` 装了两份，房间注册表分裂**
现象：`POST /matchmake/… → 200`、WebSocket **也** `101` 升级成功，但服务端立刻报
`seat reservation expired`，客户端永远进不去（本地却怎么测都是好的）。
根因：bun workspace 默认用 isolated 布局，镜像里 `@colyseus/tools`（创建房间）与
`@colyseus/ws-transport`（连接时查房间）各自解析到**不同物理副本**的 `@colyseus/core`，
两个 `MatchMaker` 单例 → 一个注册的房间另一个查不到。
→ 新增 `bunfig.toml` 指定 `linker = "hoisted"`（扁平布局，同一包只留一份），
并在 `Dockerfile` 里于安装依赖**之前**复制该文件。

**③ 网络限制**

- 主机拉不到 Docker Hub 基础镜像（阿里云加速器里也没有 `oven/bun`）→ 用可达镜像源
  `docker.m.daocloud.io` 拉取后 `docker tag` 成本地名；
- 主机 `git clone` GitHub 报 `HTTP2 framing layer` / `TLS connection was non-properly terminated`
  → 先试 `git config --global http.version HTTP/1.1`，仍失败就从本机 `tar` + `scp` 上传。

细节与命令见 `deploy/README.md` 的「常见问题」。

## 8. 已知未做（后续可选）

- 房间内没有成员列表 / 在线状态（状态里只有消息数组）；
- 没有鉴权、限流、敏感词过滤：任何人拿到域名就能进来发言；
- 历史只存在内存里，房间销毁即丢失，重启服务也会清空；
- `maxClients` 固定 4，没有动态房间/分房；
- 镜像仍有约 320 MB 生产依赖，主要来自 `colyseus` 全家桶（含 uWebSockets.js、@pm2/io、ioredis 等），
  如改成直接依赖 `@colyseus/core` + `@colyseus/tools` + `@colyseus/ws-transport` 可再瘦身，
  代价是丢掉开发用的 playground/monitor。
