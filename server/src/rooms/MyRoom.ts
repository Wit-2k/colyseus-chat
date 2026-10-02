import { Room, Client, CloseCode } from "colyseus";
import {
  ChatPayloadSchema,
  JoinOptionsSchema,
  PrivateChatPayloadSchema,
  type PrivateMessage,
} from "@colyseus-chat/shared";
import { ChatMessage, MyRoomState } from "./schema/MyRoomState.js";

/** 房间最多保留多少条聊天记录，避免状态无限增长（新加入的人会收到这段历史） */
const MAX_HISTORY_MESSAGES = 50;

export class MyRoom extends Room<{ state: MyRoomState }> {
  maxClients = 4;
  state = new MyRoomState();

  messages = {
    chat: (client: Client, payload: unknown) => {
      /**
       * 处理客户端的 "chat" 消息：先校验，再写进房间的同步状态。
       *
       * 写状态就等于广播：Colyseus 会自动把状态变化同步给房间里所有人，
       * 而且新加入房间的人会收到完整历史，所以这里不需要再手动 broadcast 一次。
       *
       * 校验这里刻意不用 Colyseus 自带的 validate()：它校验失败会直接把客户端
       * 踢下线（CloseCode.WITH_ERROR），对聊天室来说太重了 —— 一句话太长就掉线
       * 显然不合理，所以改成 safeParse + 丢弃 + 打日志。
       */
      const parsed = ChatPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        console.warn(client.sessionId, "sent an invalid chat message:", parsed.error.issues);
        return;
      }

      this.state.messages.push(
        new ChatMessage({
          sessionId: client.sessionId,
          // 昵称也来自同步状态（加入时写进去的），找不到就退化成 sessionId
          name: this.state.members.get(client.sessionId) ?? client.sessionId,
          text: parsed.data.text,
          timestamp: Date.now(),
        }),
      );

      // 超出上限就丢掉最早的那条，历史不会无限堆积
      if (this.state.messages.length > MAX_HISTORY_MESSAGES) {
        this.state.messages.shift();
      }
    },

    dm: (client: Client, payload: unknown) => {
      /**
       * 处理客户端的 "dm" 消息：一对一私聊，服务端只做转发。
       *
       * 私聊内容刻意不写进房间状态：状态是同步给全房间所有人的，写进去就等于
       * 把私聊内容广播出去（技术上也不可能只给两个人看），所以私聊只能走事件。
       * 代价是它不持久：不保留历史，刷新页面就没了，后加入的人也看不到。
       *
       * 不需要对方同意：只要对方此刻在这个房间里，就能直接发过去。
       */
      const parsed = PrivateChatPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        // 和 chat 一样：校验失败只丢弃并打日志，不把客户端踢下线
        console.warn(client.sessionId, "sent an invalid dm:", parsed.error.issues);
        return;
      }

      const { to, text } = parsed.data;

      // 不能发给自己：客户端不会给出这个入口，但服务端不能信任客户端
      if (to === client.sessionId) {
        console.warn(client.sessionId, "tried to dm themselves");
        return;
      }

      // 只能发给当前还在房间里的人：对方可能刚好离开/掉线，
      // 这时回一条 dm_error 让前端提示"对方已离开"，而不是静默丢掉
      const target = this.clients.get(to);
      if (target === undefined) {
        client.send("dm_error", { to, reason: "offline" });
        return;
      }

      const message: PrivateMessage = {
        from: client.sessionId,
        // 昵称一律以服务端记录为准（加入时写进 members 的那份），不采信客户端传来的名字
        fromName: this.state.members.get(client.sessionId) ?? client.sessionId,
        to,
        text,
        timestamp: Date.now(),
      };

      // 收件人一份 + 发送者自己一份（回执）：前端统一按服务器时间戳渲染
      target.send("dm", message);
      client.send("dm", message);
    },
  };

  onJoin(client: Client, options: unknown) {
    /**
     * Called when a client joins the room.
     * 从加入参数里取昵称，没传或不合格时退化成 sessionId，保证一定有可显示的名字。
     * 昵称写进同步状态里的成员列表（key 是 sessionId），客户端据此渲染在线成员。
     */
    const parsed = JoinOptionsSchema.safeParse(options);
    const name =
      parsed.success && parsed.data.name !== undefined ? parsed.data.name : client.sessionId;

    this.state.members.set(client.sessionId, name);
    console.log(client.sessionId, "joined as", name);
  }

  onLeave(client: Client, code: CloseCode) {
    /**
     * Called when a client leaves the room.
     * 从成员列表里删掉；这条变化同样会自动同步给房间里剩下的人。
     */
    this.state.members.delete(client.sessionId);
    console.log(client.sessionId, "left!", code);
  }

  onDispose() {
    /**
     * Called when the room is disposed.
     * 房间本身连同状态一起销毁，不需要额外清理。
     */
    console.log("room", this.roomId, "disposing...");
  }
}
