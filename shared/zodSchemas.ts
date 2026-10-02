/**
 * 前后端共享的聊天协议（zod 配方）。
 *
 * 这是一个 workspace 包（@colyseus-chat/shared）：server 和 client 都直接
 * `import { ... } from "@colyseus-chat/shared"`，双方对消息结构、长度上限的理解
 * 完全一致，不会各写一套导致对不上。
 *
 * 约定：
 *   客户端 -> 服务端：发送 "chat" 消息，内容形如 { text: "你好" }
 *   客户端 -> 服务端：发送 "dm" 消息，内容形如 { to: "对方sessionId", text: "悄悄话" }
 *   服务端 -> 客户端：私聊内容用 "dm" 事件投递给双方（收件人 + 发送者自己各一份）
 *   服务端 -> 客户端：私聊发不出去时回 "dm_error" 事件（目前只有"对方不在房间"）
 *   加入房间时的可选参数：{ name: "昵称" }，不传就用 sessionId 当昵称
 *
 * 注意：服务端发出去的公共聊天记录不在这里定义，它是房间的同步状态
 * （server/src/rooms/schema/MyRoomState.ts），这样后加入房间的人能直接拿到历史记录。
 * 私聊反过来：它必须只给两个人看，所以走事件而不是同步状态 —— 状态是广播给全房间的。
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

/**
 * 客户端发来的私聊消息。
 * `to` 是对方的 sessionId（房间成员列表里的 key）；正文规则和公共消息一致，
 * 共用同一个长度上限，只是收件人不同。
 */
export const PrivateChatPayloadSchema = z.object({
  to: z.string().trim().min(1),
  text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});

export type PrivateChatPayload = z.infer<typeof PrivateChatPayloadSchema>;

/**
 * 服务端投递给双方的私聊消息（事件，不是同步状态）。
 * 收件人和发送者收到的是同一条；`from` / `fromName` 由服务端填写，
 * 客户端传什么都不作数（防止冒用别人的名字）。
 */
export type PrivateMessage = {
  from: string; // 发送者 sessionId
  fromName: string; // 发送者昵称（服务端记录的那份）
  to: string; // 收件人 sessionId
  text: string; // 正文（已 trim）
  timestamp: number; // 服务器时间戳（毫秒）
};

/** 私聊没送出去时的回执：目前只有"对方已经不在房间里"这一种情况 */
export type PrivateMessageError = {
  to: string;
  reason: "offline";
};
