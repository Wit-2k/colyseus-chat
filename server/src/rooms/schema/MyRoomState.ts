import { schema, t, type SchemaType } from "@colyseus/schema";

/**
 * 一条聊天记录。
 * 它同时是"存起来的历史"和"发给客户端的数据结构"——Colyseus 会把它按二进制同步给
 * 房间里所有人，后加入房间的人也能一次性收到已有的历史。
 */
export const ChatMessage = schema({
  sessionId: t.string(), // 发送者的会话 ID，前端可用它判断哪条消息是自己发的
  name: t.string(), // 发送者昵称
  text: t.string(), // 消息正文
  timestamp: t.number(), // 服务器时间戳（毫秒），用于显示发送时间
});

export const MyRoomState = schema({
  /** 最近的聊天记录，会被同步给所有客户端 */
  messages: t.array(ChatMessage),
});
export type MyRoomState = SchemaType<typeof MyRoomState>;
export type ChatMessage = SchemaType<typeof ChatMessage>;
