/**
 * 前后端共享的聊天协议（zod 配方）。
 *
 * 这是一个 workspace 包（@colyseus-chat/shared）：server 和 client 都直接
 * `import { ... } from "@colyseus-chat/shared"`，双方对消息结构、长度上限的理解
 * 完全一致，不会各写一套导致对不上。
 *
 * 约定：
 *   客户端 -> 服务端：发送 "chat" 消息，内容形如 { text: "你好" }
 *   加入房间时的可选参数：{ name: "昵称" }，不传就用 sessionId 当昵称
 *
 * 注意：服务端发出去的聊天记录不在这里定义，它是房间的同步状态
 * （server/src/rooms/schema/MyRoomState.ts），这样后加入房间的人能直接拿到历史记录。
 */
import { z } from "zod";

/** 单条消息最大长度，前端输入框和后端校验共用同一个值 */
export const MAX_MESSAGE_LENGTH = 500;

/** 昵称最大长度 */
export const MAX_NAME_LENGTH = 20;

/**
 * 客户端发来的聊天消息。
 * 注意 trim()：先去掉首尾空白再判空，避免有人发一堆空格刷屏。
 */
export const ChatPayloadSchema = z.object({
  text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});

/** 加入房间时的可选参数 */
export const JoinOptionsSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH).optional(),
});

export type ChatPayload = z.infer<typeof ChatPayloadSchema>;
export type JoinOptions = z.infer<typeof JoinOptionsSchema>;
