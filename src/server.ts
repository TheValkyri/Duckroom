import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { getRouter } from "./router";
import { startInstance } from "./start";

const startHandler = createStartHandler({
  createRouter: getRouter,
  startInstance,
})(defaultStreamHandler);

export default {
  async fetch(request: Request) {
    try {
      return await startHandler(request);
    } catch (error) {
      console.error("SSR Handler Error:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
};
