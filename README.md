# colyseus-chat

一个 Colyseus + Svelte 的简易聊天室，使用 monorepo（workspaces）组织。

## 目录结构

```
.
├── shared/   前后端共享的协议（zod 配方）—— 消息结构、长度上限都定义在这里
├── server/   Colyseus 服务器（房间逻辑、状态同步）
├── client/   Svelte 前端
├── deploy/   线上 nginx 配置与部署说明
├── docs/     协议标准与实现细节
└── scripts/  开发辅助脚本（本地一键起三个进程）
```

`shared` 是一个真正的 workspace 包（包名 `@colyseus-chat/shared`）。`server` 和 `client`
都通过包名 import 它，所以两边对消息格式的理解永远一致。它会被编译到 `shared/dist`
（只提交源码，`dist` 是构建产物），server 编译时、client 打包时都读编译后的文件。

**改了 `shared/` 的代码后需要重新编译**：跑 `bun run dev` 时 `shared` 会自己 watch 编译，
单独跑某个子包时 `prestart` / `prebuild` 会自动先编译一次。

## 文档

| 文档                                           | 内容                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`docs/protocol.md`](docs/protocol.md)         | **协议标准**：连接流程（匹配 + WebSocket）、消息格式与字段规则、长度上限、历史语义、边界行为、演进规则 |
| [`docs/architecture.md`](docs/architecture.md) | **实现细节**：为什么 shared 要编译、服务端与客户端的实现取舍、开发流程与测试覆盖、线上拓扑、踩坑记录   |
| [`deploy/README.md`](deploy/README.md)         | 部署步骤、更新方式、网络受限时的处理（Docker Hub / GitHub 直连）                                       |

## 环境要求

- [Bun](https://bun.sh/)（包管理器 + 跑脚本）
- Node.js >= 22（服务器运行环境）

## 常用命令

在**仓库根目录**执行：

| 命令                | 作用                                                                   |
| ------------------- | ---------------------------------------------------------------------- |
| `bun install`       | 安装所有子包的依赖（只需在根目录装一次）                               |
| `bun run dev`       | 一键启动：shared 编译监听 + 服务器 + 前端                              |
| `bun run build`     | 依次编译 shared、server、client                                        |
| `bun run test`      | 跑服务器测试                                                           |
| `bun run release`   | 发布到云主机（本机构建 → 上传产物 → 主机装配镜像并重启，稳态约 12 秒） |
| `bun run typecheck` | 三个子包的类型检查                                                     |

也可以进入子目录单独操作（`cd server && bun run start`、`cd client && bun run dev`）。

代码质量检查用项目自带的 Vite+ 工具链（前端 `dev` / `build` 也是走 `vp`）：

| 命令                | 作用                                             |
| ------------------- | ------------------------------------------------ |
| `vp check`          | 格式化 + lint（配置在根目录 `vite.config.ts`）   |
| `vp check --fix`    | 同上，并自动修好可修的（git 提交钩子也是跑这个） |
| `bun run typecheck` | 三个子包的类型检查（含 `svelte-check`）          |

## 前端（client）

- Svelte 5（runes）+ `@colyseus/sdk`，房间名 `my_room`（和 `server/src/app.config.ts` 注册的一致），最多 4 人。
- 消息来自房间的**同步状态** `room.state.messages`：进房间时用 `getStateCallbacks()` 的
  `onAdd(cb, true)` 先把房间里的历史补上，之后每条新消息也走同一个回调 —— 历史和新消息是同一套逻辑。
- 昵称、消息内容都用共享配方（`@colyseus-chat/shared`）在本地先校验一次，规则与服务器完全一致；
  输入框也用了同一个 `MAX_MESSAGE_LENGTH` 限制长度。
- 顶部的**在线成员列表**同样来自同步状态（`room.state.members`，key 是 sessionId）：进房间先补齐当前成员，
  之后有人进出用 `onAdd` / `onRemove` 实时更新，自己的标签用蓝色标出。
- **私聊**：点在线成员的名字就能一对一发消息，**不需要对方同意**。私聊走 `dm` 事件点对点投递、
  不进同步状态（否则等于广播给全房间），所以服务端不保存私聊历史，前端只在当前页面内存里按对方分组保存；
  没打开的会话会在名字标签上显示未读数，对方离开后输入框会锁上。
- 布局**响应式**：手机上是全宽单列（`100dvh` + 刘海/底部横条安全区留白 + 44px 触控目标），
  宽屏上面板最宽 720px。

服务器地址默认是 `ws://localhost:2567`（开发）／当前页面地址（生产，前后端同源），
**通常不需要配置**。只有想把前端连到另一台服务器时才用环境变量覆盖（Vite 要求 `VITE_` 前缀）：

```bash
# client/.env.local
VITE_SERVER_URL=wss://另一台服务器
```

## 部署

线上是**同源部署**：nginx 只做 TLS 终止 + 反向代理，页面静态文件和 WebSocket 都由
Colyseus 服务提供（`chat-server` 容器）。这样 nginx 不用区分静态资源和 ws 请求 ——
Colyseus 的 matchmaking 和 WebSocket 都在根路径上，本来就没法跟静态站并存。

- **发布**：本机执行 `bun run release` —— 本机构建三端 → 只上传几百 KB 产物 → 主机装配镜像并重启容器（稳态约 12 秒）
- 容器定义：根目录 `Dockerfile`（三阶段：`deps` 装依赖、`app` 装配产物、`all` 从源码全量构建兜底）
- 站点配置：`deploy/nginx/go-comm.space.conf`（整站反代到 `chat-server:2567`）
- 首次部署与手动兜底：见 [`deploy/README.md`](deploy/README.md)

本地想验证生产形态（页面和服务器同源）：

```bash
bun run build
NODE_ENV=production node server/build/index.js   # 打开 http://localhost:2567 就是构建后的页面
```

注意：**依赖在主机镜像里装、产物在本机构建后传过去**（本机 Windows 与主机 Linux 的
`node_modules` 不能互换），所以发布脚本只传几百 KB 产物，主机上不需要仓库源码，也不需要构建工具链。
