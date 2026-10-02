import { Room, Client, CloseCode } from "colyseus";
import {
  ChatPayloadSchema,
  JoinOptionsSchema,
} from "@colyseus-chat/shared";
import { ChatMessage, MyRoomState } from "./schema/MyRoomState.js";

/** 房间最多保留多少条聊天记录，避免状态无限增长（新加入的人会收到这段历史） */
const MAX_HISTORY_MESSAGES = 50;

export class MyRoom extends Room<{ state: MyRoomState }> {
  maxClients = 4;
  state = new MyRoomState();

  /** sessionId -> 昵称。玩家离开房间时记得删掉，否则会一直占用内存 */
  private names = new Map<string, string>();

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
        console.warn(
          client.sessionId,
          "sent an invalid chat message:",
          parsed.error.issues,
        );
        return;
      }

      this.state.messages.push(
        new ChatMessage({
          sessionId: client.sessionId,
          name: this.names.get(client.sessionId) ?? client.sessionId,
          text: parsed.data.text,
          timestamp: Date.now(),
        }),
      );

      // 超出上限就丢掉最早的那条，历史不会无限堆积
      if (this.state.messages.length > MAX_HISTORY_MESSAGES) {
        this.state.messages.shift();
      }
    },
  };

  onCreate(options: unknown) {
    /**
     * Called when a new room is created.
     * 目前没有需要初始化的东西（消息监听通过上面的 messages 声明式注册）。
     */
  }

  onJoin(client: Client, options: unknown) {
    /**
     * Called when a client joins the room.
     * 从加入参数里取昵称，没传或不合格时退化成 sessionId，保证一定有可显示的名字。
     */
    const parsed = JoinOptionsSchema.safeParse(options);
    const name =
      parsed.success && parsed.data.name !== undefined
        ? parsed.data.name
        : client.sessionId;

    this.names.set(client.sessionId, name);
    console.log(client.sessionId, "joined as", name);
  }

  onLeave(client: Client, code: CloseCode) {
    /**
     * Called when a client leaves the room.
     */
    this.names.delete(client.sessionId);
    console.log(client.sessionId, "left!", code);
  }

  onDispose() {
    /**
     * Called when the room is disposed.
     */
    this.names.clear();
    console.log("room", this.roomId, "disposing...");
  }

}
