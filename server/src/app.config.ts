import express from "express";
import { fileURLToPath } from "node:url";
import {
  defineServer,
  defineRoom,
  monitor,
  playground,
  createRouter,
  createEndpoint,
} from "colyseus";

/**
 * Import your Room files
 */
import { MyRoom } from "./rooms/MyRoom.js";

const server = defineServer({
  /**
   * Define your room handlers:
   */
  rooms: {
    my_room: defineRoom(MyRoom),
  },

  /**
   * Experimental: Define API routes. Built-in integration with the "playground" and SDK.
   *
   * Usage from SDK:
   *   client.http.get("/api/hello").then((response) => {})
   *
   */
  routes: createRouter({
    api_hello: createEndpoint("/api/hello", { method: "GET" }, async () => {
      return { message: "Hello World" };
    }),
  }),

  /**
   * Bind your custom express routes here:
   * Read more: https://expressjs.com/en/starter/basic-routing.html
   */
  express: (app) => {
    app.get("/hi", (req, res) => {
      res.send("It's time to kick ass and chew bubblegum!");
    });

    /**
     * Use @colyseus/monitor
     * If you expose it in production, make sure to protect it with a password:
     * https://docs.colyseus.io/tools/monitoring#password-protection
     */
    if (process.env.NODE_ENV !== "production") {
      app.use("/monitor", monitor());
    }

    /**
     * Use @colyseus/playground
     * (It is not recommended to expose this route in a production environment)
     */
    if (process.env.NODE_ENV !== "production") {
      app.use("/", playground());
    }

    /**
     * 托管前端静态文件（client/dist）。
     *
     * 线上就是这样部署的：nginx 只负责 TLS + 反向代理，页面和 WebSocket 都由 Colyseus
     * 这同一个服务提供 —— 前后端同源，自然没有跨域问题，nginx 也不用区分"哪个请求是
     * WebSocket"（Colyseus 的 ws 和 matchmaking 都在根路径上，和静态页面天然冲突）。
     *
     * 路径用 import.meta.url 推导，和启动时的工作目录无关：
     *   开发（tsx 跑 src）  : server/src   → ../../client/dist
     *   生产（node 跑 build）: server/build → ../../client/dist
     * 前端没构建过时这里会退化成 404，不影响开发（开发时前端在 vite 上跑）。
     */
    app.use(express.static(fileURLToPath(new URL("../../client/dist", import.meta.url))));
  },
});

export default server;
