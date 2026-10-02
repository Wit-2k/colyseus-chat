<script lang="ts">
  import { Client, getStateCallbacks, type Room } from "@colyseus/sdk";
  import {
    ChatPayloadSchema,
    JoinOptionsSchema,
    MAX_MESSAGE_LENGTH,
    MAX_NAME_LENGTH,
    PrivateChatPayloadSchema,
    type PrivateMessage,
    type PrivateMessageError,
  } from "@colyseus-chat/shared";

  // 服务器地址：
  //   - 生产环境前后端同源（页面本身由 Colyseus 托管），直接用当前页面的地址即可，
  //     SDK 会自动把 https:// 换成 wss://
  //   - 本地开发时前端在 5173、服务器在 2567，得显式指定
  // 想连到别的服务器时，用 VITE_SERVER_URL 覆盖（构建时注入）
  const SERVER_URL =
    import.meta.env.VITE_SERVER_URL ??
    (import.meta.env.DEV ? "ws://localhost:2567" : window.location.origin);

  // 房间名要和服务器 server/src/app.config.ts 里注册的保持一致
  const ROOM_NAME = "my_room";

  /**
   * 前端用得到的一条聊天记录。
   * 真正的定义在服务端 server/src/rooms/schema/MyRoomState.ts；
   * Colyseus 会把同步下来的状态解码成这些字段，这里声明一份给类型检查用。
   */
  type ChatMessageView = {
    sessionId: string;
    name: string;
    text: string;
    timestamp: number;
  };

  /** 房间状态里前端用到的字段：聊天记录 + 成员列表 */
  type ChatState = {
    messages: ChatMessageView[];
    /** sessionId -> 昵称（房间成员列表，MapSchema 解码后是 Map 形态） */
    members: Map<string, string>;
  };

  /**
   * 一个私聊会话：key 是对方的 sessionId。
   * 私聊不走同步状态（那样等于广播给全房间），所以它只留在这个页面的内存里，
   * 刷新就没了 —— 这是服务端不保存私聊历史的必然结果。
   */
  type Conversation = {
    peerId: string;
    /** 对方昵称：对方离开后成员列表里就查不到了，所以会话里留一份 */
    peerName: string;
    /** 和公共消息同一个形状（sessionId = 发送者），模板可以共用一套渲染 */
    messages: ChatMessageView[];
    /** 没打开这个会话时攒下的条数，显示在名字标签上 */
    unread: number;
  };

  let name = $state("");
  let draft = $state("");
  let messages = $state<ChatMessageView[]>([]);
  /** 房间成员（顺序即加入顺序，和服务端一致） */
  let members = $state<{ sessionId: string; name: string }[]>([]);
  let status = $state<"idle" | "joining" | "joined">("idle");
  let error = $state("");
  let mySessionId = $state("");

  /** 私聊会话，key 是对方 sessionId */
  let conversations = $state<Record<string, Conversation>>({});
  /** 当前打开的是哪个会话：空串 = 公共聊天室 */
  let activePeerId = $state("");

  /** 当前显示的消息：公共聊天室 或 正在私聊的那一位 */
  const shownMessages = $derived(
    activePeerId === "" ? messages : (conversations[activePeerId]?.messages ?? []),
  );

  /** 正在私聊的对方昵称（对方已离开时成员列表里查不到，退回会话里存的那份） */
  const activePeerName = $derived(
    activePeerId === ""
      ? ""
      : (members.find((member) => member.sessionId === activePeerId)?.name ??
        conversations[activePeerId]?.peerName ??
        activePeerId),
  );

  /** 对方是否还在房间里：不在就不允许再发（服务端也会回 dm_error 兜底） */
  const activePeerOnline = $derived(
    activePeerId !== "" && members.some((member) => member.sessionId === activePeerId),
  );

  // 房间是第三方类实例：用 $state.raw 存，避免被 Svelte 的深层代理包一层
  let room = $state.raw<Room<unknown, ChatState> | undefined>(undefined);

  // 消息列表容器，来新消息时滚到底部
  let listElement = $state.raw<HTMLDivElement | undefined>(undefined);

  /** 进入聊天室 */
  async function join() {
    // 昵称用共享配方校验，规则和服务器完全一致
    const parsed = JoinOptionsSchema.safeParse({ name });
    if (!parsed.success) {
      error = `昵称请填 1~${MAX_NAME_LENGTH} 个字符`;
      return;
    }

    status = "joining";
    error = "";

    try {
      const client = new Client(SERVER_URL);
      const joined = await client.joinOrCreate<ChatState>(ROOM_NAME, {
        name: parsed.data.name,
      });

      const callbacks = getStateCallbacks(joined);
      const state = callbacks(joined.state);

      // immediate=true：先把房间里已有的历史消息补进来，之后每来一条也会触发同一个回调
      state.messages.onAdd((message) => {
        messages.push({
          sessionId: message.sessionId,
          name: message.name,
          text: message.text,
          timestamp: message.timestamp,
        });
      }, true);

      // 成员列表：进房间时先补上当前成员（immediate），之后有人进出分别触发下面两个回调
      state.members.onAdd((memberName, sessionId) => {
        members.push({ sessionId, name: memberName });
      }, true);
      state.members.onRemove((_memberName, sessionId) => {
        members = members.filter((member) => member.sessionId !== sessionId);
      });

      // 掉线时给个提示，别让界面一直停在"已连接"的假象里
      joined.onLeave(() => {
        status = "idle";
        error = "与服务器断开了连接";
      });

      // 私聊：一条消息会投给双方（对方 + 我自己的回执），所以先按发送者判断"对方"是谁，
      // 再把这条归进对应的会话
      joined.onMessage<PrivateMessage>("dm", (message) => {
        const peerId = message.from === joined.sessionId ? message.to : message.from;
        const peerName =
          message.from === joined.sessionId
            ? (members.find((member) => member.sessionId === peerId)?.name ?? peerId)
            : message.fromName;

        const conversation = (conversations[peerId] ??= {
          peerId,
          peerName,
          messages: [],
          unread: 0,
        });
        conversation.messages.push({
          sessionId: message.from,
          name: message.fromName,
          text: message.text,
          timestamp: message.timestamp,
        });

        // 不是我自己发的、而且当前没在看这个人 → 记一条未读，标在名字标签上
        if (message.from !== joined.sessionId && activePeerId !== peerId) {
          conversation.unread += 1;
        }
      });

      // 私聊没送出去（对方刚好离开房间）：给出提示，不让消息静默消失
      joined.onMessage<PrivateMessageError>("dm_error", (info) => {
        const peerName =
          members.find((member) => member.sessionId === info.to)?.name ??
          conversations[info.to]?.peerName ??
          "对方";
        error = `${peerName} 已经离开房间，这条私聊没有发出去`;
      });

      room = joined;
      mySessionId = joined.sessionId;
      status = "joined";
    } catch (cause) {
      status = "idle";
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  /** 对方离开后就不能再发私聊了：输入框和发送按钮都锁上 */
  const composerLocked = $derived(activePeerId !== "" && !activePeerOnline);

  /** 打开某个人的私聊会话（没聊过就先建一个空会话），顺便清掉未读 */
  function openDm(peerId: string) {
    const peerName = members.find((member) => member.sessionId === peerId)?.name ?? peerId;
    const conversation = (conversations[peerId] ??= {
      peerId,
      peerName,
      messages: [],
      unread: 0,
    });
    conversation.unread = 0;
    activePeerId = peerId;
    draft = "";
    error = "";
  }

  /** 从私聊回到公共聊天室 */
  function backToRoom() {
    activePeerId = "";
    draft = "";
    error = "";
  }

  /** 发送消息：正在私聊就发给那一位，否则发到公共聊天室 */
  function send() {
    if (room === undefined) {
      return;
    }

    // 发之前用共享配方校验（规则和服务器完全一致）：空白、超长直接拦在本地，不用白跑一趟网络。
    // 公共消息的配方会把多余的字段丢掉，所以两种模式可以共用同一个对象
    const parsed =
      activePeerId === ""
        ? ChatPayloadSchema.safeParse({ text: draft })
        : PrivateChatPayloadSchema.safeParse({ to: activePeerId, text: draft });
    if (!parsed.success) {
      error = `消息不能为空，且不超过 ${MAX_MESSAGE_LENGTH} 字`;
      return;
    }

    error = "";
    room.send(activePeerId === "" ? "chat" : "dm", parsed.data);
    draft = "";
  }

  /** 时间戳（服务器时间）显示成 时:分 */
  function formatTime(timestamp: number) {
    return new Date(timestamp).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // 有新消息就滚到底部；切换会话（公共 ↔ 私聊、换个人私聊）时也要滚到底
  // （读 shownMessages 本身就是为了让它成为依赖：换会话时换的是另一个数组，effect 会重跑）
  $effect(() => {
    const list = shownMessages;
    if (list.length > 0) {
      listElement?.scrollTo({ top: listElement.scrollHeight });
    }
  });
</script>

<main class="chat">
  {#if status !== "joined"}
    <form
      class="join"
      onsubmit={(event) => {
        event.preventDefault();
        join();
      }}
    >
      <h1>聊天室</h1>
      <p class="hint">
        输入一个昵称就能进来聊天，房间里最近 50 条消息都会显示给你；点在线成员的名字可以私聊。
      </p>

      <label for="nickname">昵称</label>
      <input
        id="nickname"
        bind:value={name}
        maxlength={MAX_NAME_LENGTH}
        placeholder="比如：小明"
        autocomplete="off"
      />

      <button type="submit" disabled={status === "joining"}>
        {status === "joining" ? "连接中…" : "进入聊天室"}
      </button>

      {#if error}
        <p class="error">{error}</p>
      {/if}
    </form>
  {:else}
    <header>
      {#if activePeerId === ""}
        <strong>聊天室</strong>
        <span class="me">在线 {members.length} 人</span>
      {:else}
        <button class="back" type="button" onclick={backToRoom}>← 返回</button>
        <strong>私聊 · {activePeerName}</strong>
        <span class="me">{activePeerOnline ? "在线" : "已离开"}</span>
      {/if}
    </header>

    <div class="members">
      {#each members as member}
        {#if member.sessionId === mySessionId}
          <span class="chip mine">{member.name}（我）</span>
        {:else}
          <button
            class="chip"
            class:active={member.sessionId === activePeerId}
            type="button"
            title="和 {member.name} 私聊（只有你们两个人能看到）"
            onclick={() => openDm(member.sessionId)}
          >
            {member.name}
            {#if (conversations[member.sessionId]?.unread ?? 0) > 0}
              <span class="badge">{conversations[member.sessionId]?.unread}</span>
            {/if}
          </button>
        {/if}
      {/each}
    </div>

    <div class="messages" bind:this={listElement}>
      {#if shownMessages.length === 0}
        <p class="empty">
          {activePeerId === ""
            ? "还没有人说话，来开个头吧。"
            : `这里只有你和 ${activePeerName} 能看到。`}
        </p>
      {/if}

      {#each shownMessages as message}
        <article class:mine={message.sessionId === mySessionId}>
          <div class="meta">
            <span class="who">{message.name}</span>
            <time>{formatTime(message.timestamp)}</time>
          </div>
          <p class="text">{message.text}</p>
        </article>
      {/each}
    </div>

    <form
      class="compose"
      onsubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <input
        bind:value={draft}
        maxlength={MAX_MESSAGE_LENGTH}
        placeholder={activePeerId === "" ? "说点什么…" : `私聊 ${activePeerName}…`}
        autocomplete="off"
        aria-label="消息内容"
        disabled={composerLocked}
      />
      <span class="count">{draft.length}/{MAX_MESSAGE_LENGTH}</span>
      <button type="submit" disabled={composerLocked || draft.trim().length === 0}>发送</button>
    </form>

    {#if error}
      <p class="error">{error}</p>
    {/if}
  {/if}
</main>
