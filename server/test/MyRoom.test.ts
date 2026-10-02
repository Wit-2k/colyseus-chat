import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config.js";
import type { MyRoomState } from "../src/rooms/schema/MyRoomState.js";
import { MAX_MESSAGE_LENGTH } from "@colyseus-chat/shared";

describe("MyRoom 聊天室", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => colyseus = await boot(appConfig));
  after(async () => colyseus.shutdown());

  beforeEach(async () => {
    await colyseus.cleanup();
  });

  it("消息会同步给房间里的所有人（包括发送者自己）", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", {});
    const alice = await colyseus.connectTo(room, { name: "Alice" });
    const bob = await colyseus.connectTo(room, { name: "Bob" });

    // 先挂上"下一次状态变化"的等待，再发消息，避免竞态
    const bobPatch = bob.waitForNextPatch();
    const alicePatch = alice.waitForNextPatch();
    alice.send("chat", { text: "  你好  " });
    await Promise.all([bobPatch, alicePatch]);

    assert.strictEqual(bob.state.messages.length, 1);
    assert.strictEqual(alice.state.messages.length, 1);

    const message = bob.state.messages[0];
    assert.strictEqual(message.text, "你好", "首尾空白应被 trim");
    assert.strictEqual(message.name, "Alice", "昵称来自加入房间时的参数");
    assert.strictEqual(message.sessionId, alice.sessionId);
    assert.strictEqual(typeof message.timestamp, "number");
  });

  it("后加入房间的人能直接拿到历史记录", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", {});
    const alice = await colyseus.connectTo(room, { name: "Alice" });

    const patch = alice.waitForNextPatch();
    alice.send("chat", { text: "第一条" });
    alice.send("chat", { text: "第二条" });
    await patch;

    // connectTo 内部已经等到了完整的初始状态，所以这里可以立刻断言
    const carol = await colyseus.connectTo(room, { name: "Carol" });
    assert.strictEqual(carol.state.messages.length, 2);
    assert.deepStrictEqual(
      Array.from(carol.state.messages, (m) => m.text),
      ["第一条", "第二条"],
    );
  });

  it("非法消息不会写进历史", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", {});
    const alice = await colyseus.connectTo(room, { name: "Alice" });

    const patch = alice.waitForNextPatch();
    alice.send("chat", { text: "   " }); // 全空白
    alice.send("chat", { text: 42 }); // 不是字符串
    alice.send("chat", {}); // 缺字段
    alice.send("chat", null); // null
    alice.send("chat", { text: "x".repeat(MAX_MESSAGE_LENGTH + 1) }); // 超长
    alice.send("chat", { text: "x".repeat(MAX_MESSAGE_LENGTH) }); // 合法：正好到上限
    await patch;

    assert.strictEqual(alice.state.messages.length, 1, "只有合法的那条应该留下来");
    assert.strictEqual(alice.state.messages[0].text.length, MAX_MESSAGE_LENGTH);
  });

  it("历史只保留最近 50 条", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", {});
    const alice = await colyseus.connectTo(room, { name: "Alice" });

    const patch = alice.waitForNextPatch();
    for (let i = 1; i <= 51; i++) {
      alice.send("chat", { text: `第 ${i} 条` });
    }
    await patch;

    assert.strictEqual(alice.state.messages.length, 50, "超出上限应丢掉最早的");
    assert.strictEqual(alice.state.messages[0].text, "第 2 条");
    assert.strictEqual(alice.state.messages[49].text, "第 51 条");
  });

  it("没传昵称时用 sessionId 兜底", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", {});
    const alice = await colyseus.connectTo(room, { name: "Alice" });
    const anon = await colyseus.connectTo(room, {});

    const patch = alice.waitForNextPatch();
    anon.send("chat", { text: "我是谁" });
    await patch;

    assert.strictEqual(alice.state.messages.length, 1);
    assert.strictEqual(alice.state.messages[0].name, anon.sessionId);
  });
});
