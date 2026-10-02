# colyseus-chat

一个 Colyseus + Svelte 的简易聊天室，使用 monorepo（workspaces）组织。

## 目录结构

```
.
├── shared/   前后端共享的协议（zod 配方）—— 消息结构、长度上限都定义在这里
├── server/   Colyseus 服务器（房间逻辑、状态同步）
├── client/   Svelte 前端
└── scripts/  开发辅助脚本（本地一键起三个进程）
```

`shared` 是一个真正的 workspace 包（包名 `@colyseus-chat/shared`）。`server` 和 `client`
都通过包名 import 它，所以两边对消息格式的理解永远一致。它会被编译到 `shared/dist`
（只提交源码，`dist` 是构建产物），server 编译时、client 打包时都读编译后的文件。

**改了 `shared/` 的代码后需要重新编译**：跑 `bun run dev` 时 `shared` 会自己 watch 编译，
单独跑某个子包时 `prestart` / `prebuild` 会自动先编译一次。

## 环境要求

- [Bun](https://bun.sh/)（包管理器 + 跑脚本）
- Node.js >= 22（服务器运行环境）

## 常用命令

在**仓库根目录**执行：

| 命令 | 作用 |
| --- | --- |
| `bun install` | 安装所有子包的依赖（只需在根目录装一次） |
| `bun run dev` | 一键启动：shared 编译监听 + 服务器 + 前端 |
| `bun run build` | 依次编译 shared、server、client |
| `bun run test` | 跑服务器测试 |
| `bun run typecheck` | 三个子包的类型检查 |

也可以进入子目录单独操作（`cd server && bun run start`）。

## 部署（服务器）

`server` 编译产物是 `server/build/`，入口 `server/build/index.js`：

```bash
bun install                 # 仓库根目录
bun run --filter server build
node server/build/index.js  # 生产环境默认监听 2567，可用 PORT 覆盖
```

注意：因为是 monorepo，部署时要把整个仓库拉过去（`server` 依赖根目录 `node_modules`
里的 `@colyseus-chat/shared`），不能只拷 `server` 目录。
