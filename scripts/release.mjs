// 一条命令发布：本机构建 → 只把产物传到云主机 → 主机装配镜像并重启容器。
//
// 为什么这么分工：
//   - 云主机是 2 核小机器，在它上面跑前端构建要 2~6 分钟；同样的构建在本机不到 1 秒。
//   - 但依赖不能直接搬过去：本机是 Windows、主机是 Linux，node_modules 里有平台相关的东西。
//   - 所以：**依赖在主机镜像里装（有缓存，依赖不变就不用重装），产物在本机构建后传过去**。
//     部署上下文只有几份 package.json + 三份产物，约几百 KB，主机的 docker build 只重放
//     几个 COPY 层，秒级完成。
//
// 用法：在仓库根目录执行 `bun run release`
import { spawn } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contextDir = join(repoRoot, ".deploy-context");
const sshHost = "aliyun"; // WSL 里的 ssh 别名
const remoteDir = "/root/deploy-context";

/** 跑一个命令并继承输出；失败就抛出（避免带着半成品继续部署） */
function run(command, args, cwd = repoRoot) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(new Error(`${command} ${args.join(" ")} 退出码 ${code}`));
      }
    });
  });
}

/** Windows 路径 → WSL 路径（scp/ssh 只在 WSL 里配置好了） */
function toWslPath(winPath) {
  return winPath
    .replace(/^([A-Za-z]):\\/, (_, drive) => `/mnt/${drive.toLowerCase()}/`)
    .replaceAll("\\", "/");
}

function log(step, message) {
  console.log(`\n[release] ${step} ${message}`);
}

// ── 1. 本机构建（快）──────────────────────────────────────────────
log("1/4", "本机构建 shared → server → client …");
const startedAt = Date.now();
await run("bun", ["run", "build"]);
console.log(`[release]    构建完成，用时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

// ── 2. 组装部署上下文（几百 KB）───────────────────────────────────
log("2/4", "组装部署上下文（清单文件 + 三份产物）…");
await rm(contextDir, { recursive: true, force: true });

for (const dir of [
  "shared",
  "server",
  "client",
  "artifacts/server/build",
  "artifacts/shared/dist",
  "artifacts/client/dist",
]) {
  await mkdir(join(contextDir, dir), { recursive: true });
}

for (const file of ["package.json", "bun.lock", "bunfig.toml", "Dockerfile"]) {
  await cp(join(repoRoot, file), join(contextDir, file));
}
for (const file of ["shared/package.json", "server/package.json", "client/package.json"]) {
  await cp(join(repoRoot, file), join(contextDir, file));
}
await cp(join(repoRoot, "server/build"), join(contextDir, "artifacts/server/build"), {
  recursive: true,
});
await cp(join(repoRoot, "shared/dist"), join(contextDir, "artifacts/shared/dist"), {
  recursive: true,
});
await cp(join(repoRoot, "client/dist"), join(contextDir, "artifacts/client/dist"), {
  recursive: true,
});

// ── 3. 上传 + 主机装配 + 重启 + 冒烟检查 ──────────────────────────
log("3/4", `上传到云主机并装配镜像（${sshHost}）…`);

const remoteScript = [
  "set -e",
  `rm -rf ${remoteDir} && mkdir -p ${remoteDir}`,
  `tar xzf /root/ctx.tgz -C ${remoteDir}`,
  "rm -f /root/ctx.tgz",
  `cd ${remoteDir}`,
  'echo "--- 主机装配（只重放产物层）---"',
  "docker build --target app -t colyseus-chat . | tail -6",
  'echo "--- 更新容器 ---"',
  "docker rm -f chat-server >/dev/null 2>&1 || true",
  "docker run -d --name chat-server --network chat-net --restart unless-stopped colyseus-chat >/dev/null",
  "sleep 3",
  'echo -n "容器: " && docker ps --filter name=chat-server --format "{{.Status}}"',
  'curl -s -o /dev/null -w "首页: %{http_code}\\n" https://go-comm.space/',
].join("\n");

await run("wsl", [
  "-e",
  "bash",
  "-c",
  `cd ${toWslPath(contextDir)} && tar czf /tmp/ctx.tgz . && scp -q /tmp/ctx.tgz ${sshHost}:/root/ctx.tgz && ssh -o BatchMode=yes ${sshHost} '${remoteScript}'`,
]);

// ── 4. 收尾 ───────────────────────────────────────────────────────
log("4/4", "清理本地临时目录…");
await rm(contextDir, { recursive: true, force: true });
console.log(`[release] 完成，总用时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
