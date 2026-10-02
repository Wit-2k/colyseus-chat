#!/usr/bin/env bun
/** 验证指定网站是否可访问 */

async function check(url: string, timeoutMs = 10_000): Promise<boolean> {
  // 自动补协议
  if (!/^https?:\/\//.test(url)) {
    url = `https://${url}`;
  }

  try {
    const resp = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs), // Bun 内置，无需手动 setTimeout
    });
    return resp.status < 400;
  } catch {
    // HTTPS 失败（证书、超时等）→ 回退 HTTP
    if (url.startsWith("https://")) {
      try {
        const resp = await fetch(url.replace("https://", "http://"), {
          method: "HEAD",
          redirect: "follow",
          signal: AbortSignal.timeout(timeoutMs),
        });
        return resp.status < 400;
      } catch {
        return false;
      }
    }
    return false;
  }
}

// ── CLI 入口 ──
const target = process.argv[2];

if (!target) {
  console.log("用法: bun run ConnectionTest.ts <域名或URL>");
  process.exit(1);
}

const accessible = await check(target);
console.log(`${target} → ${accessible ? "✅ 可访问" : "❌ 不可访问"}`);
process.exit(accessible ? 0 : 1);
