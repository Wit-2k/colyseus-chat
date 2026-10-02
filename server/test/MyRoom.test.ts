import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config.js";
import type { MyRoomState } from "../src/rooms/schema/MyRoomState.js";
import {
  MAX_MESSAGE_LENGTH,
  type PrivateMessage,
  type PrivateMessageError,
} from "@colyseus-chat/shared";

describe("MyRoom 聊天室", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => (colyseus = await boot(appConfig)));
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

  it("成员列表：有人加入会同步，离开会被移除", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", {});
    const alice = await colyseus.connectTo(room, { name: "Alice" });

    // 自己进来后，列表里只有自己（key 是 sessionId，value 是昵称）
    assert.deepStrictEqual(Object.fromEntries(alice.state.members.entries()), {
      [alice.sessionId]: "Alice",
    });

    // Bob 加入后，Alice 这边应该看到两个成员，且顺序就是加入顺序
    const joinPatch = alice.waitForNextPatch();
    const bob = await colyseus.connectTo(room, { name: "Bob" });
    await joinPatch;

    assert.deepStrictEqual(Array.from(alice.state.members.keys()), [
      alice.sessionId,
      bob.sessionId,
    ]);
    assert.strictEqual(alice.state.members.get(bob.sessionId), "Bob");
    assert.strictEqual(bob.state.members.size, 2, "后加入的人也应该看到完整成员列表");

    // Bob 离开后，Alice 的列表里只剩自己
    const leavePatch = alice.waitForNextPatch();
    await bob.leave();
    await leavePatch;

    assert.deepStrictEqual(Array.from(alice.state.members.keys()), [alice.sessionId]);
  });

  it("私聊只发给双方，不写进公共历史", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", {});
    const alice = await colyseus.connectTo(room, { name: "Alice" });
    const bob = await colyseus.connectTo(room, { name: "Bob" });
    const carol = await colyseus.connectTo(room, { name: "Carol" });

    const deliveredToBob = Promise.withResolvers<PrivateMessage>();
    const deliveredToAlice = Promise.withResolvers<PrivateMessage>();
    const carolInbox: PrivateMessage[] = [];
    bob.onMessage("dm", deliveredToBob.resolve);
    alice.onMessage("dm", deliveredToAlice.resolve);
    carol.onMessage("dm", (message: PrivateMessage) => carolInbox.push(message));

    alice.send("dm", { to: bob.sessionId, text: "  只给你看  " });
    // 双方各收到一份，两条都等到再断言
    const [received, echo] = await Promise.all([deliveredToBob.promise, deliveredToAlice.promise]);

    assert.strictEqual(received.text, "只给你看", "首尾空白应被 trim");
    assert.strictEqual(received.from, alice.sessionId);
    assert.strictEqual(received.fromName, "Alice", "昵称以服务端记录为准");
    assert.strictEqual(received.to, bob.sessionId);
    assert.strictEqual(typeof received.timestamp, "number");

    // 发送者自己也收到一份（回执）：前端用它拿到服务器时间戳，不做"本地先显示"
    assert.deepStrictEqual(echo, received);

    // 房间里没被选中的第三方收不到，公共历史里也不该出现
    assert.strictEqual(carolInbox.length, 0, "私聊不能泄露给房间里其他人");
    assert.strictEqual(room.state.messages.length, 0, "私聊不写进公共历史");
  });

  it("对方已经离开房间时，发送者收到 dm_error", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", {});
    const alice = await colyseus.connectTo(room, { name: "Alice" });
    const bob = await colyseus.connectTo(room, { name: "Bob" });

    await bob.leave();

    const inbox: PrivateMessage[] = [];
    alice.onMessage("dm", (message: PrivateMessage) => inbox.push(message));

    const failure = Promise.withResolvers<PrivateMessageError>();
    alice.onMessage("dm_error", failure.resolve);
    alice.send("dm", { to: bob.sessionId, text: "还在吗" });

    assert.deepStrictEqual(await failure.promise, { to: bob.sessionId, reason: "offline" });
    assert.strictEqual(inbox.length, 0, "对方不在时不应该再投递私聊");
  });

  it("发给自己或格式不对的私聊会被丢弃", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", {});
    const alice = await colyseus.connectTo(room, { name: "Alice" });

    const inbox: unknown[] = [];
    alice.onMessage("dm", (message: unknown) => inbox.push(message));

    alice.send("dm", { to: alice.sessionId, text: "自言自语" }); // 发给自己
    alice.send("dm", { to: "", text: "收件人为空" }); // 收件人为空
    alice.send("dm", { to: alice.sessionId, text: "   " }); // 正文全空白
    alice.send("dm", { to: 42, text: "收件人类型不对" }); // 类型不对
    alice.send("dm", null); // 整个载荷为 null

    // 拿一条公共消息当"水位线"：它同步回来时，前面这些 dm 都已经在服务端处理过了
    const patch = alice.waitForNextPatch();
    alice.send("chat", { text: "我还在" });
    await patch;

    assert.strictEqual(inbox.length, 0);
    assert.strictEqual(alice.state.messages.length, 1, "正常的公共消息不受影响");
  });
});
