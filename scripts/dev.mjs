// 一条命令同时起三个开发进程：
//   shared —— tsc --watch，把共享协议编译到 shared/dist（server / client 都从这里取）
//   server —— tsx watch，Colyseus 服务器
//   client —— vite，Svelte 前端
//
// 这样写是为了不引入额外依赖（concurrently 之类），Windows 上也能直接用。
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const jobs = [
  { name: "shared", cwd: join(repoRoot, "shared"), script: "dev" },
  { name: "server", cwd: join(repoRoot, "server"), script: "start" },
  { name: "client", cwd: join(repoRoot, "client"), script: "dev" },
];

const children = [];

for (const job of jobs) {
  const child = spawn("bun", ["run", job.script], {
    cwd: job.cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // 给每个进程的输出加前缀，混在一起时也能分清是谁在说话
  const prefix = `[${job.name}] `;
  const forward = (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.length > 0) {
        console.log(prefix + line);
      }
    }
  };
  child.stdout.on("data", forward);
  child.stderr.on("data", forward);

  child.on("exit", (code) => {
    console.log(`${prefix}进程退出，退出码 ${code}`);
    // 任何一个挂掉就整体退出，避免留下半个环境让人以为还活着
    shutdown();
  });

  children.push(child);
}

let stopping = false;
function shutdown() {
  if (stopping) {
    return;
  }
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) {
      child.kill();
    }
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("开发环境已启动：shared(tsc watch) + server(tsx watch) + client(vite)");
console.log("按 Ctrl+C 停止。");
