<script lang="ts">
  import { Client, getStateCallbacks, type Room } from "@colyseus/sdk";
  import {
    ChatPayloadSchema,
    JoinOptionsSchema,
    MAX_MESSAGE_LENGTH,
    MAX_NAME_LENGTH,
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

  /** 房间状态里前端只用到 messages */
  type ChatState = { messages: ChatMessageView[] };

  let name = $state("");
  let draft = $state("");
  let messages = $state<ChatMessageView[]>([]);
  let status = $state<"idle" | "joining" | "joined">("idle");
  let error = $state("");
  let mySessionId = $state("");

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

      // immediate=true：先把房间里已有的历史消息补进来，之后每来一条也会触发同一个回调
      callbacks(joined.state).messages.onAdd((message) => {
        messages.push({
          sessionId: message.sessionId,
          name: message.name,
          text: message.text,
          timestamp: message.timestamp,
        });
      }, true);

      // 掉线时给个提示，别让界面一直停在"已连接"的假象里
      joined.onLeave(() => {
        status = "idle";
        error = "与服务器断开了连接";
      });

      room = joined;
      mySessionId = joined.sessionId;
      status = "joined";
    } catch (cause) {
      status = "idle";
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  /** 发送消息 */
  function send() {
    if (room === undefined) {
      return;
    }

    // 发之前用共享配方校验：空白、超长直接拦在本地，不用白跑一趟网络
    const parsed = ChatPayloadSchema.safeParse({ text: draft });
    if (!parsed.success) {
      error = `消息不能为空，且不超过 ${MAX_MESSAGE_LENGTH} 字`;
      return;
    }

    error = "";
    room.send("chat", parsed.data);
    draft = "";
  }

  /** 时间戳（服务器时间）显示成 时:分 */
  function formatTime(timestamp: number) {
    return new Date(timestamp).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // 有新消息就滚到底部（读 messages.length 是为了让它成为这个 effect 的依赖）
  $effect(() => {
    if (messages.length > 0) {
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
      <p class="hint">输入一个昵称就能进来聊天，房间里最近 50 条消息都会显示给你。</p>

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
      <strong>聊天室</strong>
      <span class="me">我：{name}</span>
    </header>

    <div class="messages" bind:this={listElement}>
      {#if messages.length === 0}
        <p class="empty">还没有人说话，来开个头吧。</p>
      {/if}

      {#each messages as message}
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
        placeholder="说点什么…"
        autocomplete="off"
        aria-label="消息内容"
      />
      <span class="count">{draft.length}/{MAX_MESSAGE_LENGTH}</span>
      <button type="submit" disabled={draft.trim().length === 0}>发送</button>
    </form>

    {#if error}
      <p class="error">{error}</p>
    {/if}
  {/if}
</main>
